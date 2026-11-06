begin;

-- Members are told by email when they receive a connection or mentoring
-- request, and requesters when theirs is accepted. The scheduled API job that
-- already sends unread-message alerts claims these jobs through two service-role
-- RPCs; the email carries no name or message, only a link to the site.
create table private.request_email_queue (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in ('received', 'accepted')),
  created_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  finished_at timestamptz,
  -- Re-running a trigger or a migration never queues a second email for one event.
  constraint request_email_queue_event_unique unique (request_id, event)
);
create index request_email_queue_due_idx on private.request_email_queue(next_attempt_at) where status in ('pending', 'processing');
create index request_email_queue_recipient_idx on private.request_email_queue(recipient_id);
create index request_email_queue_first_attempt_idx on private.request_email_queue(first_attempt_at) where first_attempt_at is not null;
alter table private.request_email_queue enable row level security;
revoke all on private.request_email_queue from public, anon, authenticated, service_role;

-- Runs with the owner's rights: members cannot write the private queue.
create function private.enqueue_request_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_kind not in ('mentoring'::public.connection_request_kind, 'connection'::public.connection_request_kind) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into private.request_email_queue (request_id, recipient_id, event)
      values (new.id, new.recipient_id, 'received') on conflict (request_id, event) do nothing;
  elsif old.status = 'pending'::public.connection_request_status
    and new.status = 'accepted'::public.connection_request_status then
    insert into private.request_email_queue (request_id, recipient_id, event)
      values (new.id, new.requester_id, 'accepted') on conflict (request_id, event) do nothing;
  end if;
  return new;
end;
$$;

create trigger enqueue_request_email
after insert or update of status on public.connection_requests
for each row execute function private.enqueue_request_email();

-- Claims due jobs under a lease. A job is cancelled when its email has become
-- pointless (the request was answered first, alerts were turned off, the member
-- lost access) and fails after five attempts or once Brevo's 30-minute
-- idempotency window is close. At most 60 first attempts per UTC day: unread-
-- message alerts keep their own 180, leaving Brevo's free tier for sign-ups.
create function public.request_claim_notifications(p_limit integer default 5)
returns table(job_id uuid, lease_token uuid, request_id uuid, event text, request_kind text, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.request_email_queue;
  request public.connection_requests;
  email_address text;
  token uuid;
  claimed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  if private.maintenance_active() then return; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('requests:email-budget', 0)) then return; end if;
  for job in select q.* from private.request_email_queue q
    where q.status in ('pending', 'processing') and q.next_attempt_at <= clock_timestamp()
      and (q.lease_until is null or q.lease_until <= clock_timestamp())
    order by q.next_attempt_at, q.id for update skip locked
  loop
    exit when claimed >= p_limit;
    select * into request from public.connection_requests r where r.id = job.request_id;
    select u.email into email_address from auth.users u join public.profiles p on p.id = u.id
      where u.id = job.recipient_id and p.is_active and p.profile_completed
        and not exists (select 1 from private.hub_suspensions s where s.user_id = p.id);
    if request.status is distinct from (case job.event when 'received' then 'pending' else 'accepted' end)::public.connection_request_status
      or nullif(email_address, '') is null
      or not coalesce((select m.email_enabled from private.messaging_members m where m.user_id = job.recipient_id), true) then
      update private.request_email_queue q set status = 'cancelled', finished_at = clock_timestamp(), lease_until = null
        where q.id = job.id;
      continue;
    end if;
    if job.attempts >= 5 or job.first_attempt_at <= clock_timestamp() - interval '25 minutes' then
      update private.request_email_queue q set status = 'failed', finished_at = clock_timestamp(), lease_until = null
        where q.id = job.id;
      continue;
    end if;
    if job.first_attempt_at is null and (select count(*) from private.request_email_queue q
      where q.first_attempt_at >= date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC') >= 60 then
      continue;
    end if;
    token := gen_random_uuid();
    update private.request_email_queue q set status = 'processing', attempts = q.attempts + 1,
      first_attempt_at = coalesce(q.first_attempt_at, clock_timestamp()),
      lease_token = token, lease_until = clock_timestamp() + interval '5 minutes'
      where q.id = job.id;
    job_id := job.id; lease_token := token; request_id := job.request_id; event := job.event;
    request_kind := request.request_kind::text; email := email_address;
    claimed := claimed + 1;
    return next;
  end loop;
end;
$$;

create function public.request_finish_notification(p_job_id uuid, p_lease_token uuid, p_success boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.request_email_queue;
begin
  if p_success is null then raise exception 'Delivery result is required' using errcode = '22023'; end if;
  select * into job from private.request_email_queue where id = p_job_id for update;
  if not found or job.status <> 'processing' or job.lease_token is distinct from p_lease_token
    or job.lease_until <= clock_timestamp() then
    raise exception 'Notification lease is no longer valid' using errcode = '42501';
  end if;
  update private.request_email_queue set
    status = case when p_success then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
    finished_at = case when p_success or attempts >= 5 then clock_timestamp() end,
    next_attempt_at = clock_timestamp() + make_interval(mins => least(60, (2 ^ job.attempts)::integer)),
    lease_until = null, lease_token = null
    where id = job.id;
end;
$$;

revoke all on function private.enqueue_request_email() from public, anon, authenticated, service_role;
revoke all on function public.request_claim_notifications(integer), public.request_finish_notification(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.request_claim_notifications(integer), public.request_finish_notification(uuid, uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';

commit;
