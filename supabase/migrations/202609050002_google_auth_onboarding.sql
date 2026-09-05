begin;

-- Existing members completed the original registration form. Only new Google
-- accounts need the additional school/profile information after OAuth.
alter table public.profiles
  add column profile_completed boolean not null default true;
alter table public.profiles add constraint profiles_incomplete_members_inactive
  check (profile_completed or (not is_active and member_role = 'student'::public.member_role));

comment on column public.profiles.profile_completed is
  'False for new Google accounts until complete_member_profile validates the member form. Existing members remain completed.';

create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role public.member_role;
  provider_name text;
  provider_photo text;
begin
  -- app_metadata is maintained by Supabase Auth. User-editable metadata must
  -- never choose whether the Google onboarding requirement applies.
  if new.raw_app_meta_data ->> 'provider' = 'google' then
    provider_name := regexp_replace(btrim(coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      new.raw_user_meta_data ->> 'name', ''
    )), '[[:space:]]+', ' ', 'g');
    provider_photo := coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      new.raw_user_meta_data ->> 'picture'
    );

    insert into public.profiles (
      id, first_name, last_name, member_role, graduation_year, specialty,
      city, country, experience, photo_url, offers_mentoring, gender,
      is_active, profile_completed
    ) values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'given_name'), ''), split_part(provider_name, ' ', 1)),
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'family_name'), ''),
        case when strpos(provider_name, ' ') > 0 then substr(provider_name, strpos(provider_name, ' ') + 1) else '' end),
      'student'::public.member_role, null, '', null, null, '',
      case when provider_photo ~* '^https://[^/[:space:]]+(/[^[:space:]]*)?$' then provider_photo else null end,
      false, null, false, false
    );

    insert into public.profile_contacts (profile_id, email, is_visible)
      values (new.id, coalesce(new.email, ''), false);
    return new;
  end if;

  -- Preserve the existing email/password registration contract.
  requested_role := case
    when new.raw_user_meta_data ->> 'member_role' = 'student' then 'student'::public.member_role
    else 'alumni'::public.member_role
  end;

  insert into public.profiles (
    id, first_name, last_name, member_role, graduation_year, specialty,
    city, country, experience, offers_mentoring, gender
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'first_name', ''), 'Membre'),
    coalesce(nullif(new.raw_user_meta_data ->> 'last_name', ''), 'LSNB'),
    requested_role,
    nullif(new.raw_user_meta_data ->> 'graduation_year', '')::integer,
    coalesce(new.raw_user_meta_data ->> 'specialty', ''),
    new.raw_user_meta_data ->> 'city',
    new.raw_user_meta_data ->> 'country',
    coalesce(new.raw_user_meta_data ->> 'experience', ''),
    requested_role = 'alumni'::public.member_role
      and coalesce((new.raw_user_meta_data ->> 'offers_mentoring')::boolean, false),
    case when new.raw_user_meta_data ->> 'gender' in ('male', 'female', 'unspecified')
      then new.raw_user_meta_data ->> 'gender' else null end
  );

  insert into public.profile_contacts (profile_id, email, is_visible)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce((new.raw_user_meta_data ->> 'contact_visible')::boolean, false)
  );
  return new;
end;
$$;

-- RLS permits ordinary members to edit their own profile. The completion flag
-- is managed by the validated RPC, never by a browser table update/insert.
-- SECURITY INVOKER is intentional: the definer RPC runs as its database owner,
-- while a direct PostgREST write runs as anon/authenticated.
create function public.protect_profile_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and new.profile_completed)
      or (tg_op = 'UPDATE' and new.profile_completed is distinct from old.profile_completed) then
      raise exception 'Complete the member form using complete_member_profile'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_completion
before insert or update on public.profiles
for each row execute function public.protect_profile_completion();

create function public.complete_member_profile(
  p_first_name text,
  p_last_name text,
  p_member_role text,
  p_graduation_year integer,
  p_specialty text,
  p_city text,
  p_country text,
  p_experience text,
  p_gender text,
  p_offers_mentoring boolean,
  p_contact_visible boolean,
  p_terms_accepted boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  member_email text;
  already_completed boolean;
begin
  if member_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.profile_completed into already_completed
    from public.profiles p where p.id = member_id for update;
  if not found then
    raise exception 'Member profile not found' using errcode = 'P0002';
  end if;
  -- Serializes duplicate submissions and never rewrites a completed profile.
  if already_completed then
    return false;
  end if;

  if p_member_role is null or p_member_role not in ('alumni', 'student') then
    raise exception 'Choose alumni or student' using errcode = '22023';
  end if;
  if nullif(btrim(p_first_name), '') is null or nullif(btrim(p_last_name), '') is null
    or nullif(btrim(p_specialty), '') is null or nullif(btrim(p_city), '') is null
    or nullif(btrim(p_country), '') is null or nullif(btrim(p_experience), '') is null then
    raise exception 'Complete all required profile fields' using errcode = '22023';
  end if;
  if p_graduation_year is null or p_graduation_year not between 2017 and 2040 then
    raise exception 'Graduation year must be between 2017 and 2040' using errcode = '22023';
  end if;
  if p_gender is not null and p_gender not in ('male', 'female', 'unspecified') then
    raise exception 'Invalid gender choice' using errcode = '22023';
  end if;
  if p_terms_accepted is distinct from true then
    raise exception 'Accept the membership terms to continue' using errcode = '22023';
  end if;

  select u.email into member_email from auth.users u where u.id = member_id;
  if nullif(btrim(member_email), '') is null then
    raise exception 'An email address is required' using errcode = '22023';
  end if;

  update public.profiles set
    first_name = btrim(p_first_name),
    last_name = btrim(p_last_name),
    member_role = p_member_role::public.member_role,
    graduation_year = p_graduation_year,
    specialty = btrim(p_specialty),
    city = btrim(p_city),
    country = btrim(p_country),
    experience = btrim(p_experience),
    gender = p_gender,
    offers_mentoring = p_member_role = 'alumni' and coalesce(p_offers_mentoring, false),
    profile_completed = true,
    is_active = true
    where id = member_id;

  insert into public.profile_contacts (profile_id, email, is_visible)
    values (member_id, member_email, coalesce(p_contact_visible, false))
    on conflict (profile_id) do update set
      email = excluded.email,
      is_visible = excluded.is_visible;
  return true;
end;
$$;

revoke all on function public.protect_profile_completion() from public, anon, authenticated;
revoke all on function public.complete_member_profile(text, text, text, integer, text, text, text, text, text, boolean, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_member_profile(text, text, text, integer, text, text, text, text, text, boolean, boolean, boolean)
  to authenticated;

commit;
