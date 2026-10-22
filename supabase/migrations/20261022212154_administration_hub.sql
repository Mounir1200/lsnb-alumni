begin;

-- No public/client role can write staff, suspension, audit or maintenance data.
-- Bootstrap the first administrator explicitly from the SQL console (see docs).
create table private.hub_staff (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'moderator')),
  graduation_year integer,
  created_at timestamptz not null default clock_timestamp(),
  constraint hub_staff_scope check ((role = 'admin' and graduation_year is null)
    or (role = 'moderator' and graduation_year is not null and graduation_year between 2017 and 2040))
);
create table private.hub_suspensions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  suspended_at timestamptz not null default clock_timestamp()
);
create table private.hub_maintenance (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  message text not null default 'Nous améliorons le réseau. Merci de votre patience.',
  started_at timestamptz,
  ends_at timestamptz,
  -- Keep operational state independent from membership deletion/imports.
  updated_by uuid
);
insert into private.hub_maintenance(singleton) values (true);
create table private.hub_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_name text not null,
  action text not null,
  target_id uuid,
  target_name text,
  graduation_year integer,
  reason text
);
create index hub_audit_promotion_idx on private.hub_audit(graduation_year, id desc);
create table private.member_activity (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  route text not null check (route in ('home', 'directory', 'profile', 'offers', 'highlights', 'member')),
  views integer not null default 1 check (views between 1 and 1440),
  last_seen timestamptz not null default clock_timestamp(),
  primary key(user_id, day, route)
);
create index member_activity_day_idx on private.member_activity(day);
create index profiles_graduation_active_idx on public.profiles(graduation_year, is_active);
alter table private.hub_staff enable row level security;
alter table private.hub_suspensions enable row level security;
alter table private.hub_maintenance enable row level security;
alter table private.hub_audit enable row level security;
alter table private.member_activity enable row level security;
revoke all on private.hub_staff, private.hub_suspensions, private.hub_maintenance,
  private.hub_audit, private.member_activity from public, anon, authenticated, service_role;
revoke all on sequence private.hub_audit_id_seq from public, anon, authenticated, service_role;

create function private.maintenance_active() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled and (ends_at is null or ends_at > statement_timestamp()) from private.hub_maintenance where singleton),true);
$$;
create function private.member_allowed() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid()
    and (p.is_active or not p.profile_completed)
    and not exists(select 1 from private.hub_suspensions s where s.user_id = p.id));
$$;
create function private.site_allowed() returns boolean language sql stable security definer set search_path = '' as $$
  select not private.maintenance_active() and private.member_allowed();
$$;
-- Auth signup creates profiles using a privileged trigger and therefore also
-- needs an explicit maintenance check. Existing-user sign-in remains available
-- for the separately deployed administration hub.
create function private.guard_registration() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.maintenance_active() then
    raise exception 'Registration temporarily unavailable during maintenance' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger hub_guard_registration before insert on auth.users
for each row execute function private.guard_registration();
create function private.require_staff(p_admin boolean default false) returns private.hub_staff
language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  select s.* into staff from private.hub_staff s join public.profiles p on p.id = s.user_id
    where s.user_id = auth.uid() and p.is_active and p.profile_completed
      and not exists(select 1 from private.hub_suspensions x where x.user_id = s.user_id);
  if not found or (p_admin and staff.role <> 'admin') then
    raise exception 'Forbidden: staff access required' using errcode = '42501';
  end if;
  return staff;
end;
$$;
create function private.audit_action(p_action text, p_target uuid, p_promotion integer, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into private.hub_audit(actor_id,actor_name,action,target_id,target_name,graduation_year,reason)
  select auth.uid(), concat_ws(' ', actor.first_name, actor.last_name), p_action, p_target,
    case when target.id is not null then concat_ws(' ', target.first_name, target.last_name) end, p_promotion, p_reason
    from public.profiles actor left join public.profiles target on target.id = p_target where actor.id = auth.uid();
$$;

-- Every existing permissive member policy is AND-ed with this guard. Staff
-- use explicit hub RPCs during maintenance; their member access is also closed.
do $$ declare tbl text; begin
  foreach tbl in array array['profiles','profile_contacts','connection_requests','mentorships','offers'] loop
    execute format('create policy hub_site_gate on public.%I as restrictive for all to authenticated using ((select private.site_allowed())) with check ((select private.site_allowed()))', tbl);
  end loop;
end $$;
create policy hub_avatar_insert_gate on storage.objects as restrictive for insert to authenticated with check ((select private.site_allowed()));
create policy hub_avatar_update_gate on storage.objects as restrictive for update to authenticated using ((select private.site_allowed())) with check ((select private.site_allowed()));
create policy hub_avatar_delete_gate on storage.objects as restrictive for delete to authenticated using ((select private.site_allowed()));
-- Do not reveal a suspended person's contact details through a direct REST query.
create policy hub_contact_visibility on public.profile_contacts as restrictive for select to authenticated
using (exists(select 1 from public.profiles p where p.id = profile_id and p.is_active));

create function private.guard_profile_administration() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op = 'INSERT' then
      if new.is_active then raise exception 'Account access is server-managed' using errcode = '42501'; end if;
    elsif new.is_active is distinct from old.is_active then
      raise exception 'Account access is server-managed' using errcode = '42501';
    elsif new.created_at is distinct from old.created_at then
      raise exception 'Registration time is server-managed' using errcode = '42501';
    elsif old.profile_completed and new.graduation_year is distinct from old.graduation_year then
      raise exception 'Contact administration to correct your promotion' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_profile_administration before insert or update on public.profiles
for each row execute function private.guard_profile_administration();

-- Wrap the pre-existing elevated onboarding RPC, which otherwise bypasses RLS.
alter function public.complete_member_profile(text,text,text,integer,text,text,text,text,text,boolean,boolean,boolean,text,text) set schema private;
revoke all on function private.complete_member_profile(text,text,text,integer,text,text,text,text,text,boolean,boolean,boolean,text,text) from public, anon, authenticated, service_role;
create function public.complete_member_profile(
  p_first_name text,p_last_name text,p_member_role text,p_graduation_year integer,p_specialty text,
  p_city text,p_country text,p_experience text,p_gender text,p_offers_mentoring boolean,p_contact_visible boolean,p_terms_accepted boolean, p_linkedin_url text default null,p_portfolio_url text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  if private.site_allowed() is distinct from true then raise exception 'Site unavailable or account suspended' using errcode = '42501'; end if;
  return private.complete_member_profile(p_first_name,p_last_name,p_member_role,p_graduation_year,p_specialty,
    p_city,p_country,p_experience,p_gender,p_offers_mentoring,p_contact_visible,p_terms_accepted,p_linkedin_url,p_portfolio_url);
end;
$$;

create function public.public_site_status() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled',enabled,'active',private.maintenance_active(),'message',message,
    'ends_at',ends_at,'started_at',started_at,'server_time',statement_timestamp()) from private.hub_maintenance where singleton;
$$;
create function public.member_access_status() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('active',private.member_allowed());
$$;
create function public.hub_context() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  return (select jsonb_build_object('user_id',staff.user_id,'role',staff.role,'graduation_year',staff.graduation_year,
    'display_name',concat_ws(' ',p.first_name,p.last_name)) from public.profiles p where p.id = staff.user_id);
end;
$$;
create function public.hub_members(p_search text default '',p_promotion integer default null,p_status text default 'all',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_page is null or p_page not between 1 and 100000 or p_status is null or p_status not in ('all','active','suspended')
    or length(coalesce(p_search,'')) > 100 then raise exception 'Invalid member filters' using errcode = '22023'; end if;
  if staff.role = 'moderator' and p_promotion is not null and p_promotion <> staff.graduation_year then
    raise exception 'Forbidden: promotion outside your scope' using errcode = '42501'; end if;
  return (with filtered as (
    select p.id,p.first_name,p.last_name,p.graduation_year,p.member_role,p.is_active,p.profile_completed,
      (exists(select 1 from private.hub_suspensions x where x.user_id=p.id) or (not p.is_active and p.profile_completed)) as is_suspended,
      p.created_at,p.city,p.country,s.role as staff_role
    from public.profiles p left join private.hub_staff s on s.user_id = p.id
    where (staff.role = 'admin' or p.graduation_year = staff.graduation_year)
      and (p_promotion is null or p.graduation_year = p_promotion)
      and (p_status = 'all' or (p_status = 'active' and p.is_active) or (p_status = 'suspended' and
        (exists(select 1 from private.hub_suspensions x where x.user_id=p.id) or (not p.is_active and p.profile_completed))))
      and (coalesce(p_search,'') = '' or strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(btrim(p_search))) > 0)
  ), page_rows as (select * from filtered order by created_at desc,id limit 25 offset (p_page-1)*25)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',25));
end;
$$;
create function public.hub_moderate_member(p_member_id uuid,p_active boolean,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles;
begin
  -- Common lock order serializes staff changes against moderation and prevents
  -- a race between checking the target's role and suspending them.
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff();
  if p_active is null or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'Provide a reason between 10 and 500 characters' using errcode = '22023'; end if;
  select * into target from public.profiles where id = p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if p_member_id = staff.user_id then raise exception 'You cannot moderate yourself' using errcode = '42501'; end if;
  if exists(select 1 from private.hub_staff where user_id = p_member_id) then
    raise exception 'Remove the staff role before moderating this member' using errcode = '42501'; end if;
  if staff.role = 'moderator' and (p_active or target.graduation_year is distinct from staff.graduation_year) then
    raise exception 'Forbidden: moderators may only suspend their own promotion' using errcode = '42501'; end if;
  if p_active then delete from private.hub_suspensions where user_id = p_member_id;
  else insert into private.hub_suspensions(user_id) values(p_member_id) on conflict(user_id) do nothing; end if;
  -- Restoring an incomplete Google account restores onboarding access, without
  -- making the unfinished profile visible in the member directory.
  update public.profiles set is_active = p_active and target.profile_completed where id = p_member_id;
  perform private.audit_action(case when p_active then 'member_restored' else 'member_suspended' end,p_member_id,target.graduation_year,btrim(p_reason));
end;
$$;
create function public.hub_change_promotion(p_member_id uuid,p_promotion integer,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  perform private.require_staff(true);
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
create function public.hub_set_staff(p_member_id uuid,p_role text,p_promotion integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles; old_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff(true);
  if p_role is not null and p_role not in ('admin','moderator') then raise exception 'Invalid staff role' using errcode = '22023'; end if;
  if p_member_id = staff.user_id then raise exception 'You cannot change your own staff role' using errcode = '42501'; end if;
  select * into target from public.profiles where id = p_member_id for update;
  if not found or not target.is_active or not target.profile_completed then
    raise exception 'Staff must have an active completed profile' using errcode = '22023'; end if;
  if p_role = 'moderator' and (p_promotion is null or p_promotion is distinct from target.graduation_year) then
    raise exception 'Moderators must belong to their assigned promotion' using errcode = '22023'; end if;
  if p_role = 'admin' and p_promotion is not null then raise exception 'Administrators have global scope' using errcode = '22023'; end if;
  select role into old_role from private.hub_staff where user_id = p_member_id;
  if old_role = 'admin' and p_role is distinct from 'admin'
    and (select count(*) from private.hub_staff where role = 'admin') <= 1 then
    raise exception 'The last administrator cannot be removed' using errcode = '42501'; end if;
  if p_role is null then delete from private.hub_staff where user_id = p_member_id;
  else insert into private.hub_staff(user_id,role,graduation_year) values(p_member_id,p_role,p_promotion)
    on conflict(user_id) do update set role = excluded.role, graduation_year = excluded.graduation_year; end if;
  perform private.audit_action('staff_changed',p_member_id,target.graduation_year,
    concat('Role: ',coalesce(old_role,'member'),' → ',coalesce(p_role,'member')));
end;
$$;
create function public.hub_staff() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'role',s.role,'graduation_year',s.graduation_year,
    'display_name',concat_ws(' ',p.first_name,p.last_name)) order by s.role,p.last_name),'[]'::jsonb)
    from private.hub_staff s join public.profiles p on p.id = s.user_id
    where staff.role = 'admin' or s.graduation_year = staff.graduation_year);
end;
$$;
create function public.hub_set_maintenance(p_enabled boolean,p_message text,p_ends_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  perform private.require_staff(true);
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
create function public.hub_audit(p_page integer default 1) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  staff := private.require_staff();
  if p_page is null or p_page not between 1 and 100000 then raise exception 'Invalid page' using errcode = '22023'; end if;
  return (with filtered as (select id,created_at,actor_name,action,target_name,graduation_year,reason from private.hub_audit
    where staff.role = 'admin' or graduation_year = staff.graduation_year),
    page_rows as (select * from filtered order by id desc limit 25 offset (p_page-1)*25)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
      'total',(select count(*) from filtered),'page',p_page,'page_size',25));
end;
$$;
create function public.record_member_activity(p_route text) returns void language plpgsql security definer set search_path = '' as $$
declare seen timestamptz := clock_timestamp();
begin
  if private.site_allowed() is distinct from true then raise exception 'Site unavailable or account suspended' using errcode = '42501'; end if;
  if p_route is null or p_route not in ('home','directory','profile','offers','highlights','member') then
    raise exception 'Invalid activity route' using errcode = '22023'; end if;
  if not exists(select 1 from public.profiles where id = auth.uid() and is_active and profile_completed) then return; end if;
  insert into private.member_activity(user_id,day,route,last_seen) values(auth.uid(),(seen at time zone 'UTC')::date,p_route,seen)
    on conflict(user_id,day,route) do update set views=least(1440,private.member_activity.views+1),last_seen=excluded.last_seen
    where private.member_activity.last_seen <= excluded.last_seen - interval '1 minute';
end;
$$;
create function public.hub_dashboard() returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'active_members',(select count(*) from members where is_active),'suspended_members',(select count(*) from members p
      where exists(select 1 from private.hub_suspensions x where x.user_id=p.id) or (not p.is_active and p.profile_completed)),
    'mentors',(select count(*) from members where is_active and offers_mentoring and member_role='alumni'),
    'offers',(select count(*) from public.offers o join members p on p.id=o.author_id),
    'requests',(select count(*) from public.connection_requests r where exists(select 1 from members p where p.id=r.requester_id)),
    'active_30d',(select count(distinct user_id) from events),
    'promotions',coalesce((select jsonb_agg(to_jsonb(p) order by p.year desc) from promotions p),'[]'::jsonb),
    'activity',(select jsonb_agg(to_jsonb(a) order by a.day) from activity a)));
end;
$$;

-- Explicit allowlist: no default PUBLIC execute on any new privileged helper.
revoke all on function private.maintenance_active(),private.member_allowed(),private.site_allowed(),private.require_staff(boolean),
  private.audit_action(text,uuid,integer,text),private.guard_profile_administration(),private.guard_registration() from public,anon,authenticated,service_role;
grant usage on schema private to authenticated;
grant execute on function private.site_allowed() to authenticated;
revoke all on function public.public_site_status(),public.member_access_status(),public.hub_context(),public.hub_members(text,integer,text,integer),
  public.hub_moderate_member(uuid,boolean,text),public.hub_change_promotion(uuid,integer,text),public.hub_set_staff(uuid,text,integer),public.hub_staff(),
  public.hub_set_maintenance(boolean,text,timestamptz),public.hub_audit(integer),public.record_member_activity(text),public.hub_dashboard(),
  public.complete_member_profile(text,text,text,integer,text,text,text,text,text,boolean,boolean,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.public_site_status() to anon,authenticated,service_role;
grant execute on function public.member_access_status(),public.hub_context(),public.hub_members(text,integer,text,integer),
  public.hub_moderate_member(uuid,boolean,text),public.hub_change_promotion(uuid,integer,text),public.hub_set_staff(uuid,text,integer),public.hub_staff(),
  public.hub_set_maintenance(boolean,text,timestamptz),public.hub_audit(integer),public.record_member_activity(text),public.hub_dashboard(),
  public.complete_member_profile(text,text,text,integer,text,text,text,text,text,boolean,boolean,boolean,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
