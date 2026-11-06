begin;

-- A request email used to wait for the scheduled GitHub workflow, which ran
-- three to six times a day instead of every five minutes. The queue now asks
-- the API for a round as soon as it holds an email. The workflow stays for
-- unread-message alerts, due five minutes after a message, and for retries.

-- pg_net exists on Supabase only; the local test database stubs it. Members
-- must not be able to make the database send requests of their own.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    revoke execute on all functions in schema net from public, anon, authenticated;
  end if;
end $$;

-- Who announced a request to whom, kept for one day: the rule below needs no more.
create table private.request_announcements (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  announced_at timestamptz not null default clock_timestamp()
);
create index request_announcements_requester_idx on private.request_announcements(requester_id, announced_at);
create index request_announcements_age_idx on private.request_announcements(announced_at);
alter table private.request_announcements enable row level security;
revoke all on private.request_announcements from public, anon, authenticated, service_role;

-- Immediate emails must not let one member flood others: a requester announces
-- a request to the same member once a day at most, and to ten members a day.
-- Withdrawing and asking again, or asking everyone at once, sends nothing more;
-- the requests themselves stay on the site. The lock keeps parallel requests
-- from one member from slipping past the count.
create function private.announce_request(p_requester uuid, p_recipient uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('requests:announce:' || p_requester::text, 0));
  delete from private.request_announcements where announced_at <= clock_timestamp() - interval '1 day';
  if exists (select 1 from private.request_announcements a
      where a.requester_id = p_requester and a.recipient_id = p_recipient)
    or (select count(*) from private.request_announcements a where a.requester_id = p_requester) >= 10 then
    return false;
  end if;
  insert into private.request_announcements (requester_id, recipient_id) values (p_requester, p_recipient);
  return true;
end;
$$;

-- Same queue as before, with the announcement rule on received requests.
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
    and new.status = 'accepted'::public.connection_request_status then
    insert into private.request_email_queue (request_id, recipient_id, event)
      values (new.id, new.requester_id, 'accepted') on conflict (request_id, event) do nothing;
  end if;
  return new;
end;
$$;

-- The API checks this token in constant time, and the route accepts neither a
-- recipient nor a message. The URL is the production API: wherever Vault holds
-- no token, nothing is called. Two minutes leave the free API time to wake up.
-- A failure here must never undo the member's request; its email then waits
-- for the scheduled round.
create function private.start_notification_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://lsnb-alumni-api.onrender.com/messaging/notifications/run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
  from vault.decrypted_secrets s
  where s.name = 'messaging_scheduler_token' and s.decrypted_secret ~ '^[0-9a-f]{64}$';
  return null;
exception when others then
  raise warning 'Request email round not started (%)', sqlstate;
  return null;
end;
$$;

create trigger start_notification_round
after insert on private.request_email_queue
for each row execute function private.start_notification_round();

revoke all on function private.announce_request(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.start_notification_round() from public, anon, authenticated, service_role;

commit;
