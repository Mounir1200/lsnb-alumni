begin;

-- Three levels of team, each holding the powers of those below it:
--   super_admin  network-wide; the technical side (maintenance, server logs);
--                appoints super administrators (three at most), administrators
--                and moderators.
--   admin        network-wide; every member and report, except reports about
--                administrators; appoints and removes moderators.
--   moderator    one promotion; approves and suspends its members, acts on the
--                reports about them, and reads the whole network's figures.
-- Each level manages only the levels below it, nobody changes their own role,
-- and the hub never removes a super administrator: one leaves by resigning or
-- through the database, so a stolen account cannot shut the others out.
-- Scope follows from the role: a moderator has a promotion, the others none.
alter table private.hub_staff drop constraint hub_staff_role_check, drop constraint hub_staff_scope;
alter table private.hub_staff
  add constraint hub_staff_role_check check (role in ('super_admin', 'admin', 'moderator')),
  add constraint hub_staff_scope check ((role in ('super_admin', 'admin') and graduation_year is null)
    or (role = 'moderator' and graduation_year is not null and graduation_year between 2017 and 2040));

create function private.role_rank(p_role text) returns integer language sql immutable set search_path = '' as $$
  select case p_role when 'super_admin' then 3 when 'admin' then 2 when 'moderator' then 1 else 0 end;
$$;

-- A moderator covers their promotion; administrators and super administrators the whole network.
create function private.staff_covers(p_staff private.hub_staff, p_promotion integer) returns boolean
language sql immutable set search_path = '' as $$
  select p_staff.graduation_year is null or p_staff.graduation_year = p_promotion;
$$;

-- Three super administrators at most, whichever path writes the team: the hub or SQL.
create function private.cap_super_admins() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role = 'super_admin' then
    perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
    if (select count(*) from private.hub_staff where role = 'super_admin' and user_id <> new.user_id) >= 3 then
      raise exception 'There can be at most 3 super administrators' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger cap_super_admins before insert or update of role on private.hub_staff
for each row execute function private.cap_super_admins();

drop function private.require_staff(boolean);
create function private.require_staff(p_min_role text default 'moderator') returns private.hub_staff
language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  select s.* into staff from private.hub_staff s join public.profiles p on p.id = s.user_id
    where s.user_id = auth.uid() and p.is_active and p.profile_completed
      and not exists(select 1 from private.hub_suspensions x where x.user_id = s.user_id);
  if not found or private.role_rank(staff.role) < private.role_rank(p_min_role) then
    raise exception 'Forbidden: staff access required' using errcode = '42501';
  end if;
  return staff;
end;
$$;

-- What a team member may act on: a report about anyone below them, within
-- their scope, never about themselves. Super administrators also handle the
-- reports about each other.
create or replace function private.report_in_scope(p_staff private.hub_staff, p_reported uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_reported <> p_staff.user_id and exists (
    select 1 from public.profiles p left join private.hub_staff s on s.user_id = p.id
    where p.id = p_reported and private.staff_covers(p_staff, p.graduation_year)
      and (private.role_rank(s.role) < private.role_rank(p_staff.role) or (s.role = 'super_admin' and p_staff.role = 'super_admin')));
$$;

-- What a team member sees: every report about a regular member, across the
-- network, so a problematic profile is known to every promotion; reports
-- about the team stay with those who may act on them.
create function private.report_visible(p_staff private.hub_staff, p_reported uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.report_in_scope(p_staff, p_reported)
    or not exists (select 1 from private.hub_staff s where s.user_id = p_reported);
$$;

create function private.pending_approvals(p_staff private.hub_staff) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.profiles m
  where m.approval_pending and not private.member_suspended(m.id) and private.staff_covers(p_staff, m.graduation_year);
$$;

-- What waits for this team member: the badges of the hub's menu.
create or replace function public.hub_context() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  return (select jsonb_build_object('user_id',staff.user_id,'role',staff.role,'graduation_year',staff.graduation_year,
    'display_name',concat_ws(' ',p.first_name,p.last_name),
    'pending_approvals',private.pending_approvals(staff),
    'open_reports',(select count(*) from private.member_reports r where r.status = 'open' and private.report_visible(staff, r.reported_id)))
    from public.profiles p where p.id = staff.user_id);
end;
$$;

create or replace function public.hub_members(p_search text default '',p_promotion integer default null,p_status text default 'all',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_page is null or p_page not between 1 and 100000 or p_status is null or p_status not in ('all','active','pending','suspended')
    or length(coalesce(p_search,'')) > 100 then raise exception 'Invalid member filters' using errcode = '22023'; end if;
  if p_promotion is not null and not private.staff_covers(staff, p_promotion) then
    raise exception 'Forbidden: promotion outside your scope' using errcode = '42501'; end if;
  return (with scoped as (
    select p.id,p.first_name,p.last_name,p.graduation_year,p.member_role,p.is_active,p.profile_completed,p.approval_pending,
      private.member_suspended(p.id) as is_suspended,p.created_at,p.city,p.country,p.specialty,s.role as staff_role
    from public.profiles p left join private.hub_staff s on s.user_id = p.id
    where private.staff_covers(staff, p.graduation_year)
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

-- A moderator suspends within their promotion; restoring an account takes the network level.
create or replace function public.hub_moderate_member(p_member_id uuid,p_active boolean,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff();
  if p_active is null or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'Provide a reason between 10 and 500 characters' using errcode = '22023'; end if;
  select * into target from public.profiles where id = p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if p_member_id = staff.user_id then raise exception 'You cannot moderate yourself' using errcode = '42501'; end if;
  if exists(select 1 from private.hub_staff where user_id = p_member_id) then
    raise exception 'Remove the staff role before moderating this member' using errcode = '42501'; end if;
  if not private.staff_covers(staff, target.graduation_year) or (p_active and private.role_rank(staff.role) < private.role_rank('admin')) then
    raise exception 'Forbidden: moderators may only suspend their own promotion' using errcode = '42501'; end if;
  if p_active then delete from private.hub_suspensions where user_id = p_member_id;
  else insert into private.hub_suspensions(user_id) values(p_member_id) on conflict(user_id) do nothing; end if;
  update public.profiles set is_active = p_active and target.profile_completed where id = p_member_id;
  perform private.audit_action(case when p_active then 'member_restored' else 'member_suspended' end,p_member_id,target.graduation_year,btrim(p_reason));
end;
$$;

create or replace function public.hub_change_promotion(p_member_id uuid,p_promotion integer,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  perform private.require_staff('admin');
  if p_promotion is null or p_promotion not between 2017 and 2040
    or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'Provide a valid promotion and a reason between 10 and 500 characters' using errcode = '22023'; end if;
  select * into target from public.profiles where id=p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if exists(select 1 from private.hub_staff where user_id=p_member_id and role='moderator') then
    raise exception 'Remove the moderator role before correcting their promotion' using errcode = '42501'; end if;
  update public.profiles set graduation_year=p_promotion where id=p_member_id;
  perform private.audit_action('promotion_corrected',p_member_id,target.graduation_year,
    concat(btrim(p_reason),' | ',coalesce(target.graduation_year::text,'?'),' → ',p_promotion::text));
end;
$$;

create or replace function public.hub_set_staff(p_member_id uuid,p_role text,p_promotion integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles; old_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff('admin');
  if p_role is not null and p_role not in ('super_admin','admin','moderator') then raise exception 'Invalid staff role' using errcode = '22023'; end if;
  if p_member_id = staff.user_id then raise exception 'You cannot change your own staff role' using errcode = '42501'; end if;
  select role into old_role from private.hub_staff where user_id = p_member_id;
  if old_role = 'super_admin' then
    raise exception 'A super administrator leaves the team by resigning or through the database' using errcode = '42501'; end if;
  if staff.role <> 'super_admin' and (p_role in ('admin','super_admin') or old_role = 'admin') then
    raise exception 'Forbidden: you may only manage roles below your own' using errcode = '42501'; end if;
  select * into target from public.profiles where id = p_member_id for update;
  if not found or not target.is_active or not target.profile_completed then
    raise exception 'Staff must have an active completed profile' using errcode = '22023'; end if;
  if p_role = 'moderator' and (p_promotion is null or p_promotion is distinct from target.graduation_year) then
    raise exception 'Moderators must belong to their assigned promotion' using errcode = '22023'; end if;
  if p_role in ('admin','super_admin') and p_promotion is not null then
    raise exception 'Administrators work network-wide, without a promotion' using errcode = '22023'; end if;
  if p_role is null then delete from private.hub_staff where user_id = p_member_id;
  else insert into private.hub_staff(user_id,role,graduation_year) values(p_member_id,p_role,p_promotion)
    on conflict(user_id) do update set role = excluded.role, graduation_year = excluded.graduation_year; end if;
  perform private.audit_action('staff_changed',p_member_id,target.graduation_year,
    concat('Role: ',coalesce(old_role,'member'),' → ',coalesce(p_role,'member')));
end;
$$;

-- Anyone may step down, except the last super administrator: someone must keep the keys.
create function public.hub_leave_team() returns void language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff();
  if staff.role = 'super_admin' and (select count(*) from private.hub_staff where role = 'super_admin') <= 1 then
    raise exception 'The last super administrator cannot leave the team' using errcode = '42501'; end if;
  delete from private.hub_staff where user_id = staff.user_id;
  perform private.audit_action('staff_changed',staff.user_id,staff.graduation_year,concat('Role: ',staff.role,' → member (stepped down)'));
end;
$$;

create or replace function public.hub_staff() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'role',s.role,'graduation_year',s.graduation_year,
    'display_name',concat_ws(' ',p.first_name,p.last_name)) order by private.role_rank(s.role) desc,p.last_name),'[]'::jsonb)
    from private.hub_staff s join public.profiles p on p.id = s.user_id
    where private.staff_covers(staff, s.graduation_year));
end;
$$;

create or replace function public.hub_set_maintenance(p_enabled boolean,p_message text,p_ends_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  perform private.require_staff('super_admin');
  if p_enabled is null or length(btrim(coalesce(p_message,''))) not between 5 and 500 then
    raise exception 'Maintenance needs a message between 5 and 500 characters' using errcode = '22023'; end if;
  if p_enabled and p_ends_at is not null and p_ends_at <= clock_timestamp() then
    raise exception 'Maintenance end must be in the future' using errcode = '22023'; end if;
  update private.hub_maintenance set enabled=p_enabled,message=btrim(p_message),
    started_at=case when p_enabled then clock_timestamp() end,
    ends_at=case when p_enabled then p_ends_at end,updated_by=auth.uid() where singleton;
  perform private.audit_action(case when p_enabled then 'maintenance_enabled' else 'maintenance_disabled' end,null,null,
    concat(btrim(p_message),case when p_enabled then concat(' | end: ',coalesce(p_ends_at::text,'manual')) else '' end));
end;
$$;

create or replace function public.hub_audit(p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid page' using errcode = '22023'; end if;
  return (with filtered as (select id,created_at,actor_name,action,target_name,graduation_year,reason from private.hub_audit
    where private.staff_covers(staff, graduation_year)),
    page_rows as (select * from filtered order by id desc limit 25 offset (p_page-1)*25)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
      'total',(select count(*) from filtered),'page',p_page,'page_size',25));
end;
$$;

-- Every team member reads the whole network's figures; what waits for action stays within their scope.
create or replace function public.hub_dashboard() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff; today date := (statement_timestamp() at time zone 'UTC')::date;
begin
  staff := private.require_staff();
  return (with members as (select * from public.profiles),
    events as (select a.* from private.member_activity a where a.day between today-29 and today),
    days as (select today-29+i as day from generate_series(0,29) i),
    activity as (select d.day,
      (select count(distinct e.user_id) from events e where e.day=d.day) as active_members,
      (select coalesce(sum(e.views),0) from events e where e.day=d.day) as views,
      (select count(*) from members p where (p.created_at at time zone 'UTC')::date=d.day) as registrations from days d),
    promotions as (select graduation_year as year,count(*) as members,count(*) filter(where is_active) as active
      from members where graduation_year is not null group by graduation_year)
  select jsonb_build_object('members',(select count(*) from members),
    'active_members',(select count(*) from members where is_active),
    'pending_members',private.pending_approvals(staff),
    'suspended_members',(select count(*) from members p where private.member_suspended(p.id)),
    'mentors',(select count(*) from members where is_active and offers_mentoring and member_role='alumni'),
    'offers',(select count(*) from public.offers),
    'requests',(select count(*) from public.connection_requests),
    'active_30d',(select count(distinct user_id) from events),
    'promotions',coalesce((select jsonb_agg(to_jsonb(p) order by p.year desc) from promotions p),'[]'::jsonb),
    'activity',(select jsonb_agg(to_jsonb(a) order by a.day) from activity a)));
end;
$$;

create or replace function public.hub_approve_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff();
  select * into target from public.profiles where id = p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if not private.staff_covers(staff, target.graduation_year) then
    raise exception 'Forbidden: moderators may only approve their own promotion' using errcode = '42501'; end if;
  if not target.approval_pending then raise exception 'Member is not awaiting approval' using errcode = '22023'; end if;
  update public.profiles set approval_pending = false,
    is_active = not exists(select 1 from private.hub_suspensions s where s.user_id = p_member_id)
    where id = p_member_id;
  perform private.audit_action('member_approved',p_member_id,target.graduation_year,null);
end;
$$;

-- Those who cannot act on a report learn who is reported, why, and where things
-- stand: never the details, the author, the messages or the team's note.
create or replace function public.hub_reports(p_status text default 'open', p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_status is null or p_status not in ('open', 'handled') or p_page is null or p_page not between 1 and 100000 then
    raise exception 'Invalid report filters' using errcode = '22023';
  end if;
  return (with visible as (
      select r.*, private.report_in_scope(staff, r.reported_id) as can_act from private.member_reports r
      where private.report_visible(staff, r.reported_id) and (r.status = 'open') = (p_status = 'open')
    ), page_rows as (select * from visible order by created_at desc, id limit 25 offset (p_page - 1) * 25)
    select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at, 'handled_at', r.handled_at,
        'can_act', r.can_act,
        'details', case when r.can_act then r.details end,
        'resolution', case when r.can_act then r.resolution end,
        'handled_by_name', case when r.can_act then
          (select concat_ws(' ', h.first_name, h.last_name) from public.profiles h where h.id = r.handled_by) end,
        'reported', (select jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name),
          'graduation_year', p.graduation_year, 'is_suspended', private.member_suspended(p.id))
          from public.profiles p where p.id = r.reported_id),
        'reporter', case when r.can_act then (select jsonb_build_object('id', p.id, 'name', concat_ws(' ', p.first_name, p.last_name),
          'graduation_year', p.graduation_year) from public.profiles p where p.id = r.reporter_id) end,
        'messages', case when r.can_act and r.evidence is not null
          then convert_from(private.messaging_unseal(r.evidence, r.evidence_key_version), 'UTF8')::jsonb end
      ) order by r.created_at desc, r.id) from page_rows r), '[]'::jsonb),
      'total', (select count(*) from visible), 'page', p_page, 'page_size', 25));
end;
$$;

revoke all on function private.role_rank(text), private.staff_covers(private.hub_staff, integer), private.cap_super_admins(),
  private.require_staff(text), private.report_visible(private.hub_staff, uuid), private.pending_approvals(private.hub_staff),
  public.hub_leave_team() from public, anon, authenticated, service_role;
grant execute on function public.hub_leave_team() to authenticated;

notify pgrst, 'reload schema';

commit;
