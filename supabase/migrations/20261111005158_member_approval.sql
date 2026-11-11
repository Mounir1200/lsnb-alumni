begin;

-- A new account waits until the moderator of its promotion, or an
-- administrator, confirms that the person belongs to the school. Until then
-- nobody sees it, and it sees no more than a visitor does: pupils, many of
-- them under 18, are never exposed to an unchecked account. The account can
-- still sign in and edit its own profile. Accounts that existed before this
-- migration stay approved.
alter table public.profiles add column approval_pending boolean not null default false;
alter table public.profiles add constraint profiles_approval_needs_completed_profile
  check (not approval_pending or profile_completed);
alter table public.profiles add constraint profiles_pending_account_inactive
  check (not (approval_pending and is_active));

-- The one place that holds an account back, whichever path completes the
-- profile (email sign-up, Google onboarding) and whichever later write
-- would reactivate it (a moderator restoring a refused account, say).
create function private.hold_new_member_for_approval() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.profile_completed and (tg_op = 'INSERT' or not old.profile_completed) then
    new.approval_pending := true;
  end if;
  if new.approval_pending then new.is_active := false; end if;
  return new;
end;
$$;
create trigger hold_new_member_for_approval before insert or update on public.profiles
for each row execute function private.hold_new_member_for_approval();

create or replace function private.guard_profile_administration() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op = 'INSERT' then
      if new.is_active then raise exception 'Account access is server-managed' using errcode = '42501'; end if;
    elsif new.is_active is distinct from old.is_active then
      raise exception 'Account access is server-managed' using errcode = '42501';
    elsif new.approval_pending is distinct from old.approval_pending then
      raise exception 'Account approval is server-managed' using errcode = '42501';
    elsif new.created_at is distinct from old.created_at then
      raise exception 'Registration time is server-managed' using errcode = '42501';
    elsif old.profile_completed and new.graduation_year is distinct from old.graduation_year then
      raise exception 'Contact administration to correct your promotion' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- A waiting account keeps the site: it is not suspended.
create or replace function private.member_allowed() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid()
    and (p.is_active or not p.profile_completed or p.approval_pending)
    and not exists(select 1 from private.hub_suspensions s where s.user_id = p.id));
$$;

-- Reading other members takes an approved, active account of one's own.
create function private.member_active() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

drop policy "Authenticated members can read active profiles" on public.profiles;
create policy "Active members read active profiles, everyone their own"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (is_active and (select private.member_active())));

drop policy "Members can read visible contacts" on public.profile_contacts;
create policy "Active members read visible contacts, everyone their own"
on public.profile_contacts for select to authenticated
using (profile_id = (select auth.uid()) or (is_visible and (select private.member_active())));
-- This guard hid an inactive account's contact row from its owner too, so a
-- waiting member could neither read nor change it while editing their profile.
drop policy hub_contact_visibility on public.profile_contacts;
create policy hub_contact_visibility on public.profile_contacts as restrictive for select to authenticated
using (profile_id = (select auth.uid()) or exists(select 1 from public.profiles p where p.id = profile_id and p.is_active));

-- A suspension, or an account switched off before the hub existed. A waiting
-- account is inactive too, but it is not suspended.
create function private.member_suspended(p_member_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.hub_suspensions s where s.user_id = p_member_id)
    or exists(select 1 from public.profiles p where p.id = p_member_id
      and not p.is_active and p.profile_completed and not p.approval_pending);
$$;

create or replace function public.hub_members(p_search text default '',p_promotion integer default null,p_status text default 'all',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_page is null or p_page not between 1 and 100000 or p_status is null or p_status not in ('all','active','pending','suspended')
    or length(coalesce(p_search,'')) > 100 then raise exception 'Invalid member filters' using errcode = '22023'; end if;
  if staff.role = 'moderator' and p_promotion is not null and p_promotion <> staff.graduation_year then
    raise exception 'Forbidden: promotion outside your scope' using errcode = '42501'; end if;
  return (with scoped as (
    select p.id,p.first_name,p.last_name,p.graduation_year,p.member_role,p.is_active,p.profile_completed,p.approval_pending,
      private.member_suspended(p.id) as is_suspended,p.created_at,p.city,p.country,p.specialty,s.role as staff_role
    from public.profiles p left join private.hub_staff s on s.user_id = p.id
    where (staff.role = 'admin' or p.graduation_year = staff.graduation_year)
      and (p_promotion is null or p.graduation_year = p_promotion)
      and (coalesce(p_search,'') = '' or strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(btrim(p_search))) > 0)
  ), filtered as (
    select * from scoped m where p_status = 'all' or (p_status = 'active' and m.is_active)
      or (p_status = 'pending' and m.approval_pending and not m.is_suspended)
      or (p_status = 'suspended' and m.is_suspended)
  ), page_rows as (select * from filtered order by created_at desc,id limit 25 offset (p_page-1)*25)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',25));
end;
$$;

-- A moderator approves the accounts of their own promotion; an administrator
-- any account. A refused account is suspended with a reason instead
-- (hub_moderate_member), so it stays in the journal.
create function public.hub_approve_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff();
  select * into target from public.profiles where id = p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if staff.role = 'moderator' and target.graduation_year is distinct from staff.graduation_year then
    raise exception 'Forbidden: moderators may only approve their own promotion' using errcode = '42501'; end if;
  if not target.approval_pending then raise exception 'Member is not awaiting approval' using errcode = '22023'; end if;
  update public.profiles set approval_pending = false,
    is_active = not exists(select 1 from private.hub_suspensions s where s.user_id = p_member_id)
    where id = p_member_id;
  perform private.audit_action('member_approved',p_member_id,target.graduation_year,null);
end;
$$;

create or replace function public.hub_dashboard() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff; today date := (statement_timestamp() at time zone 'UTC')::date;
begin
  staff := private.require_staff();
  return (with members as (select * from public.profiles p where staff.role='admin' or p.graduation_year=staff.graduation_year),
    events as (select a.* from private.member_activity a join members p on p.id=a.user_id where a.day between today-29 and today),
    days as (select today-29+i as day from generate_series(0,29) i),
    activity as (select d.day,
      (select count(distinct e.user_id) from events e where e.day=d.day) as active_members,
      (select coalesce(sum(e.views),0) from events e where e.day=d.day) as views,
      (select count(*) from members p where (p.created_at at time zone 'UTC')::date=d.day) as registrations from days d),
    promotions as (select graduation_year as year,count(*) as members,count(*) filter(where is_active) as active
      from members where graduation_year is not null group by graduation_year)
  select jsonb_build_object('members',(select count(*) from members),
    'active_members',(select count(*) from members where is_active),
    'pending_members',(select count(*) from members p where p.approval_pending and not private.member_suspended(p.id)),
    'suspended_members',(select count(*) from members p where private.member_suspended(p.id)),
    'mentors',(select count(*) from members where is_active and offers_mentoring and member_role='alumni'),
    'offers',(select count(*) from public.offers o join members p on p.id=o.author_id),
    'requests',(select count(*) from public.connection_requests r where exists(select 1 from members p where p.id=r.requester_id)),
    'active_30d',(select count(distinct user_id) from events),
    'promotions',coalesce((select jsonb_agg(to_jsonb(p) order by p.year desc) from promotions p),'[]'::jsonb),
    'activity',(select jsonb_agg(to_jsonb(a) order by a.day) from activity a)));
end;
$$;

revoke all on function private.hold_new_member_for_approval(),private.member_active(),private.member_suspended(uuid),
  public.hub_approve_member(uuid) from public,anon,authenticated,service_role;
grant execute on function private.member_active() to authenticated;
grant execute on function public.hub_approve_member(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
