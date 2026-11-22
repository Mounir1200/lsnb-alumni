begin;

-- A member whose account the team approves is now told once, by e-mail, that
-- they may sign in (audit of 21 November, R1): until now nothing told them
-- when to come back. Like the team's approval e-mails, it names nobody and
-- holds neither promotion nor reason; it leads to the sign-in page.

-- One row per account approved from now on: the e-mail it is due, or was
-- sent. The row stays once the e-mail left, so an account approved again
-- never gets a second one; accounts approved before this migration have no
-- row and are never told.
create table private.account_approved_email_queue (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts between 0 and 5),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz
);
create index account_approved_email_queue_due_idx on private.account_approved_email_queue(next_attempt_at)
  where status in ('pending', 'processing');
alter table private.account_approved_email_queue enable row level security;
revoke all on private.account_approved_email_queue from public, anon, authenticated, service_role;

-- Their own daily budget, counted when an e-mail first leaves: thirty a day,
-- beside the 180 message alerts, 60 request e-mails and 20 approval e-mails
-- to the team, out of the 300 of Brevo's free plan. An e-mail beyond it waits
-- for the next day.
create table private.account_approved_email_budget (
  day date primary key,
  first_attempts integer not null default 0 check (first_attempts >= 0)
);
alter table private.account_approved_email_budget enable row level security;
revoke all on private.account_approved_email_budget from public, anon, authenticated, service_role;

-- As before (20261111005314_hub_role_levels.sql), plus the e-mail when the
-- approval makes the account active: approving a refused account, which stays
-- suspended, sends nothing.
create or replace function public.hub_approve_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff; target public.profiles; activated boolean;
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
    where id = p_member_id returning is_active into activated;
  if activated then
    insert into private.account_approved_email_queue (member_id) values (p_member_id) on conflict (member_id) do nothing;
  end if;
  perform private.audit_action('member_approved',p_member_id,target.graduation_year,null);
end;
$$;

-- The e-mail starts a round at once, as request e-mails do. A retry, due
-- later, goes with a later round.
create trigger start_account_approved_email_round after insert on private.account_approved_email_queue
for each row execute function private.start_notification_round();

-- Claims due e-mails under a lease, like the team's approval e-mails. An
-- e-mail is dropped once its account is no longer active or its address is
-- unconfirmed (an approval made outside the hub's list may reach one), and
-- fails after five attempts or near Brevo's 30-minute idempotency window.
create function public.claim_account_approved_emails(p_limit integer default 5)
returns table(job_id uuid, lease_token uuid, email text)
language plpgsql security definer set search_path = '' as $$
declare
  job private.account_approved_email_queue;
  email_address text;
  token uuid;
  claimed integer := 0;
  today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  if private.maintenance_active() then return; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('accounts:approved-email-budget', 0)) then return; end if;
  for job in select q.* from private.account_approved_email_queue q
    where q.status in ('pending', 'processing') and q.next_attempt_at <= clock_timestamp()
      and (q.lease_until is null or q.lease_until <= clock_timestamp())
    order by q.next_attempt_at, q.id for update skip locked
  loop
    exit when claimed >= p_limit;
    select u.email into email_address from auth.users u join public.profiles p on p.id = u.id
      where u.id = job.member_id and u.email_confirmed_at is not null and p.is_active
        and not exists (select 1 from private.hub_suspensions s where s.user_id = p.id);
    if nullif(email_address, '') is null then
      update private.account_approved_email_queue q set status = 'cancelled', lease_until = null, lease_token = null where q.id = job.id;
      continue;
    end if;
    if job.attempts >= 5 or job.first_attempt_at <= clock_timestamp() - interval '25 minutes' then
      update private.account_approved_email_queue q set status = 'failed', lease_until = null, lease_token = null where q.id = job.id;
      continue;
    end if;
    if job.first_attempt_at is null then
      if coalesce((select b.first_attempts from private.account_approved_email_budget b where b.day = today), 0) >= 30 then continue; end if;
      insert into private.account_approved_email_budget (day, first_attempts) values (today, 1)
        on conflict (day) do update set first_attempts = private.account_approved_email_budget.first_attempts + 1;
    end if;
    token := gen_random_uuid();
    update private.account_approved_email_queue q set status = 'processing', attempts = q.attempts + 1,
      first_attempt_at = coalesce(q.first_attempt_at, clock_timestamp()),
      lease_token = token, lease_until = clock_timestamp() + interval '5 minutes'
      where q.id = job.id;
    job_id := job.id; lease_token := token; email := email_address;
    claimed := claimed + 1;
    return next;
  end loop;
end;
$$;

create function public.finish_account_approved_email(p_job_id uuid, p_lease_token uuid, p_success boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare job private.account_approved_email_queue;
begin
  if p_success is null then raise exception 'Delivery result is required' using errcode = '22023'; end if;
  select * into job from private.account_approved_email_queue where id = p_job_id for update;
  if not found or job.status <> 'processing' or job.lease_token is distinct from p_lease_token
    or job.lease_until <= clock_timestamp() then
    raise exception 'Notification lease is no longer valid' using errcode = '42501';
  end if;
  update private.account_approved_email_queue set
    status = case when p_success then 'sent' when job.attempts >= 5 then 'failed' else 'pending' end,
    next_attempt_at = clock_timestamp() + make_interval(mins => least(60, (2 ^ job.attempts)::integer)),
    lease_until = null, lease_token = null
    where id = job.id;
end;
$$;

revoke all on function public.claim_account_approved_emails(integer), public.finish_account_approved_email(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_account_approved_emails(integer), public.finish_account_approved_email(uuid, uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';

commit;
