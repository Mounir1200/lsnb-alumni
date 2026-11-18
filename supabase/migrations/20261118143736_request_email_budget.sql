begin;

-- Request e-mails must not let members flood each other or use up the day's
-- sending budget, whatever they delete afterwards.
--
-- An acceptance is now announced like a request: the member who accepts e-mails
-- the requester once a day at most, and ten members a day, through the same log.
-- Connecting, removing the connection and connecting again queued an e-mail
-- each time, and every one of them counted against the budget shared by all.
create or replace function private.enqueue_request_email()
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
    if new.request_kind = 'connection'::public.connection_request_kind and exists (
      select 1 from public.connection_requests r
      where r.requester_id = new.requester_id and r.recipient_id = new.recipient_id
        and r.request_kind = 'mentoring'::public.connection_request_kind
        and r.status = 'pending'::public.connection_request_status) then
      return new;
    end if;
    if private.announce_request(new.requester_id, new.recipient_id) then
      insert into private.request_email_queue (request_id, recipient_id, event)
        values (new.id, new.recipient_id, 'received') on conflict (request_id, event) do nothing;
    end if;
  elsif old.status = 'pending'::public.connection_request_status
    and new.status = 'accepted'::public.connection_request_status
    -- Here the member who accepts announces it to the requester.
    and private.announce_request(new.recipient_id, new.requester_id) then
    insert into private.request_email_queue (request_id, recipient_id, event)
      values (new.id, new.requester_id, 'accepted') on conflict (request_id, event) do nothing;
  end if;
  return new;
end;
$$;

-- The sixty e-mails a day are counted in their own table, as approval e-mails
-- are. Counting queue rows let a withdrawn request, whose job goes with it,
-- give its e-mail back to the day's budget.
create table private.request_email_budget (
  day date primary key,
  first_attempts integer not null default 0 check (first_attempts >= 0)
);
alter table private.request_email_budget enable row level security;
revoke all on private.request_email_budget from public, anon, authenticated, service_role;

create or replace function public.request_claim_notifications(p_limit integer default 5)
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
  today date := (clock_timestamp() at time zone 'UTC')::date;
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
    if job.first_attempt_at is null then
      if coalesce((select b.first_attempts from private.request_email_budget b where b.day = today), 0) >= 60 then continue; end if;
      insert into private.request_email_budget (day, first_attempts) values (today, 1)
        on conflict (day) do update set first_attempts = private.request_email_budget.first_attempts + 1;
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

commit;
