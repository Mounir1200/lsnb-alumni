begin;

-- The member directory becomes visible without an account, as the school asked,
-- while each profile page still requires signing in. Visitors only get what a
-- directory card shows, through one function: the profiles table stays closed
-- to them. Students are left out: most are minors. Alumni can opt out.
alter table public.profiles add column listed_publicly boolean not null default true;

comment on column public.profiles.listed_publicly is
  'Whether an active alumni profile appears in the public directory shown to visitors. Signed-in members see every active profile.';

create function public.public_directory_profiles()
returns table(
  id uuid, first_name text, last_name text, member_role public.member_role, graduation_year integer,
  specialty text, specialties text[], domain text, city text, country text, photo_url text, offers_mentoring boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.first_name, p.last_name, p.member_role, p.graduation_year,
    p.specialty, p.specialties, p.domain, p.city, p.country, p.photo_url, p.offers_mentoring
  from public.profiles p
  where not private.maintenance_active()
    and p.is_active and p.profile_completed and p.listed_publicly
    and p.member_role = 'alumni'::public.member_role
    and not exists (select 1 from private.hub_suspensions s where s.user_id = p.id)
  order by p.last_name, p.first_name, p.id;
$$;

revoke all on function public.public_directory_profiles() from public;
grant execute on function public.public_directory_profiles() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
