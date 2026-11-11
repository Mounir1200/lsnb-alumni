begin;

-- When a newcomer waits for approval, the moderators of their promotion and
-- every administrator are told by e-mail, without any name: the e-mail only
-- counts what waits and leads to the hub. To keep within Brevo's free tier,
-- each team member gets at most one such e-mail every twelve hours, and all
-- of them together at most twenty a day (unread-message alerts keep their
-- 180, request e-mails their 60, Supabase's own e-mails the rest).

-- A newcomer is put forward once their address is confirmed: an unconfirmed
-- sign-up may be a typo or a robot, and nobody should be asked about it.
create function private.awaits_approval(p_member_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join auth.users u on u.id = p.id
      where p.id = p_member_id and p.approval_pending and u.email_confirmed_at is not null)
    and not private.member_suspended(p_member_id);
$$;

create or replace function private.pending_approvals(p_staff private.hub_staff) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.profiles m
  where private.awaits_approval(m.id) and private.staff_covers(p_staff, m.graduation_year);
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
      private.awaits_approval(p.id) as awaits_approval,
      private.member_suspended(p.id) as is_suspended,p.created_at,p.city,p.country,p.specialty,s.role as staff_role
    from public.profiles p left join private.hub_staff s on s.user_id = p.id
    where private.staff_covers(staff, p.graduation_year)
      and (p_promotion is null or p.graduation_year = p_promotion)
      and (coalesce(p_search,'') = '' or strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(btrim(p_search))) > 0)
  ), filtered as (
    select * from scoped m where p_status = 'all' or (p_status = 'active' and m.is_active)
      or (p_status = 'pending' and m.awaits_approval)
      or (p_status = 'suspended' and m.is_suspended)
  ), page_rows as (select * from filtered order by created_at desc,id limit 25 offset (p_page-1)*25)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',25));
end;
$$;

-- One row per team member: the next approval e-mail they are due. However
-- many newcomers arrive meanwhile, it stays one e-mail, which counts what
-- waits for them when it leaves.
create table private.approval_email_queue (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts between 0 and 5),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  last_sent_at timestamptz
);
create index approval_email_queue_due_idx on private.approval_email_queue(next_attempt_at) where status in ('pending', 'processing');
alter table private.approval_email_queue enable row level security;
revoke all on private.approval_email_queue from public, anon, authenticated, service_role;

-- Approval e-mails' own daily budget, counted when an e-mail first leaves.
create table private.approval_email_budget (
  day date primary key,
  first_attempts integer not null default 0 check (first_attempts >= 0)
);
alter table private.approval_email_budget enable row level security;
revoke all on private.approval_email_budget from public, anon, authenticated, service_role;

-- Tells the team members who cover this newcomer: the moderators of their
-- promotion, and administrators and super administrators. A member already
-- due an e-mail gets nothing more; the others wait out their twelve hours.
create function private.queue_approval_emails(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare promotion integer := (select p.graduation_year from public.profiles p where p.id = p_member_id);
begin
  insert into private.approval_email_queue (recipient_id)
  select s.user_id from private.hub_staff s where private.staff_covers(s, promotion)
  on conflict (recipient_id) do update set status = 'pending', attempts = 0, first_attempt_at = null,
    next_attempt_at = greatest(clock_timestamp(),
      coalesce(private.approval_email_queue.last_sent_at + interval '12 hours', clock_timestamp()))
    where private.approval_email_queue.status not in ('pending', 'processing');
end;
$$;

-- The same rule from both sides: a profile that starts waiting with a
-- confirmed address (Google onboarding, or an address confirmed at sign-up),
-- and an address confirmed while its profile waits (e-mail sign-up).
create function private.put_forward_for_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.awaits_approval(new.id) then perform private.queue_approval_emails(new.id); end if;
  return null;
end;
$$;
create trigger put_forward_new_profile after insert on public.profiles
for each row when (new.approval_pending) execute function private.put_forward_for_approval();
create trigger put_forward_waiting_profile after update on public.profiles
for each row when (new.approval_pending and not old.approval_pending) execute function private.put_forward_for_approval();
create trigger put_forward_confirmed_address after update of email_confirmed_at on auth.users
for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function private.put_forward_for_approval();

-- An e-mail due now starts a round at once, as request e-mails do; one
-- waiting out its twelve hours goes with a later round.
create trigger start_approval_email_round after insert or update of status on private.approval_email_queue
for each row when (new.status = 'pending' and new.next_attempt_at <= now())
execute function private.start_notification_round();

-- Claims due e-mails under a lease, like request e-mails. An e-mail is
-- dropped once its recipient left the team or nothing waits for them any
-- more, and fails after five attempts or near Brevo's 30-minute idempotency
-- window.
create function public.hub_claim_approval_emails(p_limit integer default 5)
returns table(job_id uuid, lease_token uuid, email text, waiting integer, promotion integer)
language plpgsql security definer set search_path = '' as $$
declare
  job private.approval_email_queue;
  staff private.hub_staff;
  email_address text;
  waiting_count integer;
  token uuid;
  claimed integer := 0;
  today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  if private.maintenance_active() then return; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('approvals:email-budget', 0)) then return; end if;
  for job in select q.* from private.approval_email_queue q
    where q.status in ('pending', 'processing') and q.next_attempt_at <= clock_timestamp()
      and (q.lease_until is null or q.lease_until <= clock_timestamp())
    order by q.next_attempt_at, q.id for update skip locked
  loop
    exit when claimed >= p_limit;
    staff := null;
    select s.* into staff from private.hub_staff s join public.profiles p on p.id = s.user_id
      where s.user_id = job.recipient_id and p.is_active and p.profile_completed
        and not exists (select 1 from private.hub_suspensions x where x.user_id = s.user_id);
    select u.email into email_address from auth.users u where u.id = job.recipient_id;
    waiting_count := case when staff.user_id is null then 0 else private.pending_approvals(staff) end;
    if staff.user_id is null or nullif(email_address, '') is null or waiting_count = 0 then
      update private.approval_email_queue q set status = 'cancelled', lease_until = null, lease_token = null where q.id = job.id;
      continue;
    end if;
    if job.attempts >= 5 or job.first_attempt_at <= clock_timestamp() - interval '25 minutes' then
      update private.approval_email_queue q set status = 'failed', lease_until = null, lease_token = null where q.id = job.id;
      continue;
    end if;
    if job.first_attempt_at is null then
      if coalesce((select b.first_attempts from private.approval_email_budget b where b.day = today), 0) >= 20 then continue; end if;
      insert into private.approval_email_budget (day, first_attempts) values (today, 1)
        on conflict (day) do update set first_attempts = private.approval_email_budget.first_attempts + 1;
    end if;
    token := gen_random_uuid();
    update private.approval_email_queue q set status = 'processing', attempts = q.attempts + 1,
      first_attempt_at = coalesce(q.first_attempt_at, clock_timestamp()),
      lease_token = token, lease_until = clock_timestamp() + interval '5 minutes'
      where q.id = job.id;
    job_id := job.id; lease_token := token; email := email_address; waiting := waiting_count; promotion := staff.graduation_year;
    claimed := claimed + 1;
    return next;
  end loop;
end;
$$;

create function public.hub_finish_approval_email(p_job_id uuid, p_lease_token uuid, p_success boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare job private.approval_email_queue;
begin
  if p_success is null then raise exception 'Delivery result is required' using errcode = '22023'; end if;
  select * into job from private.approval_email_queue where id = p_job_id for update;
  if not found or job.status <> 'processing' or job.lease_token is distinct from p_lease_token
    or job.lease_until <= clock_timestamp() then
    raise exception 'Notification lease is no longer valid' using errcode = '42501';
  end if;
  update private.approval_email_queue set
    status = case when p_success then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
    last_sent_at = case when p_success then clock_timestamp() else last_sent_at end,
    next_attempt_at = clock_timestamp() + make_interval(mins => least(60, (2 ^ job.attempts)::integer)),
    lease_until = null, lease_token = null
    where id = job.id;
end;
$$;

revoke all on function private.awaits_approval(uuid), private.queue_approval_emails(uuid), private.put_forward_for_approval(),
  public.hub_claim_approval_emails(integer), public.hub_finish_approval_email(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.hub_claim_approval_emails(integer), public.hub_finish_approval_email(uuid, uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';

commit;
