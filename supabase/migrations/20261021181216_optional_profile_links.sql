begin;

-- Optional links belong to the member profile and follow its existing RLS.
-- Existing accounts remain valid without either link.
alter table public.profiles
  add column linkedin_url text,
  add column portfolio_url text;

comment on column public.profiles.linkedin_url is
  'Optional LinkedIn profile URL, visible to authenticated members with profile access.';
comment on column public.profiles.portfolio_url is
  'Optional portfolio URL, visible to authenticated members with profile access.';

-- Validate at the database boundary as well as in the form. This function is
-- deliberately SECURITY INVOKER and reads no tables or authentication metadata.
create function public.is_valid_profile_link(p_url text, p_linkedin boolean)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  parts text[];
  authority text[];
  port_number integer;
begin
  if p_url is null then return true; end if;
  if char_length(p_url) > 2048 or p_url ~ '[[:space:][:cntrl:]\\]' then
    return false;
  end if;
  parts := regexp_match(p_url, '^(https?)://([^/?#]+)(.*)$', 'i');
  if parts is null then return false; end if;
  -- No user:password@host authorities, empty hosts, or malformed ports.
  authority := regexp_match(parts[2], '^(\[[0-9a-f:.]+\]|[[:alnum:]_-]+(\.[[:alnum:]_-]+)*\.?)(:([0-9]{1,5}))?$', 'i');
  if authority is null then return false; end if;
  port_number := authority[4]::integer;
  if port_number > 65535 then return false; end if;
  if p_linkedin then
    return authority[1] ~* '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*linkedin\.com$'
      and (port_number is null or port_number = case lower(parts[1]) when 'https' then 443 else 80 end)
      and parts[3] ~ '^/in/[^/?#]+/?([?#].*)?$';
  end if;
  return true;
end;
$$;

revoke all on function public.is_valid_profile_link(text, boolean) from public, anon;
grant execute on function public.is_valid_profile_link(text, boolean) to authenticated, service_role;

create function public.normalize_profile_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.linkedin_url := nullif(regexp_replace(new.linkedin_url, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  new.portfolio_url := nullif(regexp_replace(new.portfolio_url, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  return new;
end;
$$;

revoke all on function public.normalize_profile_links() from public, anon, authenticated, service_role;
create trigger normalize_profile_links
before insert or update of linkedin_url, portfolio_url on public.profiles
for each row execute function public.normalize_profile_links();

alter table public.profiles
  add constraint profiles_linkedin_url_check check (public.is_valid_profile_link(linkedin_url, true)),
  add constraint profiles_portfolio_url_check check (public.is_valid_profile_link(portfolio_url, false));

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
    city, country, experience, offers_mentoring, gender, linkedin_url, portfolio_url
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
      then new.raw_user_meta_data ->> 'gender' else null end,
    new.raw_user_meta_data ->> 'linkedin_url',
    new.raw_user_meta_data ->> 'portfolio_url'
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
-- Replace the old signature instead of keeping an ambiguous PostgREST overload.
-- The defaults keep the existing 12-argument clients compatible during rollout.
drop function public.complete_member_profile(text, text, text, integer, text, text, text, text, text, boolean, boolean, boolean);
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
  p_terms_accepted boolean,
  p_linkedin_url text default null,
  p_portfolio_url text default null
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
    linkedin_url = p_linkedin_url,
    portfolio_url = p_portfolio_url,
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
revoke all on function public.complete_member_profile(text, text, text, integer, text, text, text, text, text, boolean, boolean, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_member_profile(text, text, text, integer, text, text, text, text, text, boolean, boolean, boolean, text, text)
  to authenticated;

-- Refresh PostgREST after adding the columns and replacing the RPC signature.
notify pgrst, 'reload schema';

commit;
