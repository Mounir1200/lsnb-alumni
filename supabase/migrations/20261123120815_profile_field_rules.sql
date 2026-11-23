begin;

-- A member writes their own profile row directly, so whatever the site's forms
-- prevent, a call to the API could still store (audit of 21 November, M1, M2).

-- M1. A profile photo is shown to every visitor of the profile. Hosted
-- anywhere else, it tells a third party who looks at whom, and when. Only two
-- sources remain: the member's own photo in the project's storage (the one
-- name its storage rules accept, see private.is_own_avatar) and the Google
-- photo of an account created with Google. The project's address is written
-- here because the photo links stored in profiles carry it.
create function private.is_allowed_photo_url(p_url text, p_owner uuid) returns boolean
language sql immutable set search_path = '' as $$
  select p_url is null
    or p_url ~ ('^https://yesumbhssechcrlgpgqj\.supabase\.co/storage/v1/object/public/avatars/'
      || p_owner::text || '/avatar(\?v=[0-9]{1,20})?$')
    or (char_length(p_url) <= 500 and p_url ~ '^https://lh[0-9]{1,2}\.googleusercontent\.com/[A-Za-z0-9/_=.~%-]+$');
$$;

-- M2. No profile text had a maximum: one megabyte of "experience" slowed every
-- page and the hub. Each cap is what the site's forms accept (src/lib/profileLimits.ts).
create function private.is_short_text_list(p_items text[], p_max_items integer, p_max_length integer) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p_items), 0) <= p_max_items
    and not exists (select 1 from unnest(p_items) as item where char_length(item) > p_max_length);
$$;

-- A CHECK runs with the rights of whoever writes the row.
revoke all on function private.is_allowed_photo_url(text, uuid), private.is_short_text_list(text[], integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.is_allowed_photo_url(text, uuid), private.is_short_text_list(text[], integer, integer)
  to authenticated, service_role;

alter table public.profiles
  add constraint profiles_photo_url_check check (private.is_allowed_photo_url(photo_url, id)),
  add constraint profiles_first_name_length check (char_length(first_name) <= 100),
  add constraint profiles_last_name_length check (char_length(last_name) <= 100),
  add constraint profiles_specialty_length check (char_length(specialty) <= 200),
  add constraint profiles_domain_length check (char_length(domain) <= 200),
  add constraint profiles_city_length check (char_length(city) <= 150),
  add constraint profiles_country_length check (char_length(country) <= 150),
  add constraint profiles_experience_length check (char_length(experience) <= 5000),
  add constraint profiles_specialties_size check (private.is_short_text_list(specialties, 20, 120)),
  add constraint profiles_mentoring_topics_size check (private.is_short_text_list(mentoring_topics, 20, 120));

-- The contact a member shows is the address of their account. The site sent
-- it itself, so a member could show someone else's address, of any length.
create function private.own_contact_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := coalesce((select u.email from auth.users u where u.id = new.profile_id), '');
  return new;
end;
$$;
revoke all on function private.own_contact_email() from public, anon, authenticated, service_role;
create trigger own_contact_email before insert or update on public.profile_contacts
for each row execute function private.own_contact_email();
update public.profile_contacts c set email = coalesce(u.email, '')
  from auth.users u where u.id = c.profile_id and c.email is distinct from coalesce(u.email, '');

-- Accounts created with Google enter here with what Google sends: a photo
-- from another host is left out rather than refusing the account, and names
-- are cut to the profile's cap. The rest of the function is unchanged.
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
      left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'given_name'), ''), split_part(provider_name, ' ', 1)), 100),
      left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'family_name'), ''),
        case when strpos(provider_name, ' ') > 0 then substr(provider_name, strpos(provider_name, ' ') + 1) else '' end), 100),
      'student'::public.member_role, null, '', null, null, '',
      case when private.is_allowed_photo_url(provider_photo, new.id) then provider_photo end,
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

commit;
