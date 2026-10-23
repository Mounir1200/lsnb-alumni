begin;

-- A conversation is the accepted request that introduced these two members.
-- All writes use narrow RPCs; clients cannot forge identities, timestamps or receipts.
create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  conversation_id uuid not null references public.connection_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000 and body = btrim(body)),
  client_nonce uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  constraint conversation_messages_nonce unique(sender_id, client_nonce),
  constraint conversation_messages_distinct_members check(sender_id <> recipient_id)
);
create index conversation_messages_history_idx on public.conversation_messages(conversation_id, sequence desc);
create index conversation_messages_unread_idx on public.conversation_messages(recipient_id, conversation_id, sequence) where read_at is null;
alter table public.conversation_messages enable row level security;
revoke all on public.conversation_messages from public, anon, authenticated, service_role;
revoke all on sequence public.conversation_messages_sequence_seq from public, anon, authenticated, service_role;
grant select on public.conversation_messages to authenticated;
create policy "Conversation participants read their messages" on public.conversation_messages for select to authenticated
  using ((select private.site_allowed()) and (sender_id = (select auth.uid()) or recipient_id = (select auth.uid())));

create table private.messaging_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz,
  email_enabled boolean not null default true,
  last_emailed_at timestamptz,
  delivery_lease_until timestamptz,
  delivery_job_id uuid
);
create table private.messaging_email_queue (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.connection_requests(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp() + interval '5 minutes',
  status text not null default 'pending' check(status in ('pending','processing','sent','cancelled','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  first_attempt_at timestamptz,
  notification_unread_count bigint,
  lease_token uuid,
  lease_until timestamptz,
  through_sequence bigint,
  finished_at timestamptz
);
create unique index messaging_email_queue_open_idx on private.messaging_email_queue(recipient_id,conversation_id)
  where status in ('pending','processing');
create index messaging_email_queue_due_idx on private.messaging_email_queue(next_attempt_at) where status in ('pending','processing');
alter table private.messaging_members enable row level security;
alter table private.messaging_email_queue enable row level security;
revoke all on private.messaging_members,private.messaging_email_queue from public,anon,authenticated,service_role;

create function private.require_messaging_member() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if private.site_allowed() is distinct from true or not exists(
    select 1 from public.profiles where id=actor and is_active and profile_completed
  ) then raise exception 'Messaging unavailable or account ineligible' using errcode='42501'; end if;
  return actor;
end;
$$;

-- Existing request introductions remain in connection_requests. Never copy
-- historical cleartext into the new encrypted conversation history.

create function public.messaging_send_message(p_conversation_id uuid,p_body text,p_client_nonce uuid)
returns public.conversation_messages language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_messaging_member(); request public.connection_requests;
  result public.conversation_messages; peer uuid; clean_body text := btrim(p_body);
begin
  if p_client_nonce is null or clean_body is null or char_length(clean_body) not between 1 and 4000 then
    raise exception 'A message must contain between 1 and 4000 characters and a nonce' using errcode='22023'; end if;
  select * into request from public.connection_requests where id=p_conversation_id;
  if not found or request.status <> 'accepted' or actor not in (request.requester_id,request.recipient_id) then
    raise exception 'An accepted conversation is required' using errcode='42501'; end if;
  peer := case when actor=request.requester_id then request.recipient_id else request.requester_id end;
  if not exists(select 1 from public.profiles p where p.id=peer and p.is_active and p.profile_completed
    and not exists(select 1 from private.hub_suspensions s where s.user_id=p.id)) then
    raise exception 'Recipient is unavailable' using errcode='42501'; end if;
  -- Serialize same-sender retries so a lost response never creates duplicate messages.
  perform pg_advisory_xact_lock(hashtextextended('messaging:'||actor::text,0));
  select * into result from public.conversation_messages where sender_id=actor and client_nonce=p_client_nonce;
  if found then
    if result.conversation_id<>p_conversation_id or result.body<>clean_body then
      raise exception 'This nonce already belongs to a different message' using errcode='22023'; end if;
    return result;
  end if;
  if (select count(*) from public.conversation_messages where sender_id=actor
    and created_at > clock_timestamp()-interval '1 minute') >= 30 then
    raise exception 'Please wait before sending more messages' using errcode='54000'; end if;
  insert into public.conversation_messages(conversation_id,sender_id,recipient_id,body,client_nonce)
    values(p_conversation_id,actor,peer,clean_body,p_client_nonce) returning * into result;
  insert into private.messaging_members(user_id) values(peer) on conflict(user_id) do nothing;
  insert into private.messaging_email_queue(recipient_id,conversation_id) values(peer,p_conversation_id)
    on conflict(recipient_id,conversation_id) where status in ('pending','processing') do nothing;
  return result;
end;
$$;

create function public.messaging_mark_read(p_conversation_id uuid,p_through_sequence bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_messaging_member();
begin
  if p_through_sequence is null or p_through_sequence<0 then raise exception 'Invalid message sequence' using errcode='22023'; end if;
  if not exists(select 1 from public.connection_requests where id=p_conversation_id and status='accepted'
    and actor in (requester_id,recipient_id)) then
    raise exception 'An accepted conversation is required' using errcode='42501'; end if;
  update public.conversation_messages set read_at=clock_timestamp()
    where conversation_id=p_conversation_id and recipient_id=actor and sequence<=p_through_sequence and read_at is null;
  update private.messaging_email_queue q set status='cancelled',finished_at=clock_timestamp()
    where q.recipient_id=actor and q.conversation_id=p_conversation_id and q.status='pending'
      and not exists(select 1 from public.conversation_messages m
        where m.recipient_id=actor and m.conversation_id=p_conversation_id and m.read_at is null);
end;
$$;

create function public.messaging_heartbeat() returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_messaging_member();
begin
  insert into private.messaging_members(user_id,last_seen_at) values(actor,clock_timestamp())
    on conflict(user_id) do update set last_seen_at=excluded.last_seen_at;
end;
$$;
create function public.messaging_email_enabled() returns boolean language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := private.require_messaging_member();
begin return coalesce((select email_enabled from private.messaging_members where user_id=actor),true); end;
$$;
create function public.messaging_set_email_enabled(p_enabled boolean) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_messaging_member();
begin
  if p_enabled is null then raise exception 'Email preference is required' using errcode='22023'; end if;
  insert into private.messaging_members(user_id,email_enabled) values(actor,p_enabled)
    on conflict(user_id) do update set email_enabled=excluded.email_enabled;
  if not p_enabled then update private.messaging_email_queue set status='cancelled',finished_at=clock_timestamp()
    where recipient_id=actor and status='pending'; end if;
end;
$$;
create function public.messaging_unread_count() returns bigint language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := private.require_messaging_member();
begin return (select count(*) from public.conversation_messages where recipient_id=actor and read_at is null); end;
$$;
create function public.messaging_list_conversations(p_before uuid default null,p_limit integer default 100)
returns table(conversation_id uuid,last_message_body text,last_message_at timestamptz,last_sequence bigint,unread_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := private.require_messaging_member();
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size' using errcode='22023'; end if;
  return query select r.id,m.body,m.created_at,m.sequence,
    (select count(*) from public.conversation_messages u where u.conversation_id=r.id and u.recipient_id=actor and u.read_at is null)
    from public.connection_requests r
    left join lateral(select x.body,x.created_at,x.sequence from public.conversation_messages x
      where x.conversation_id=r.id order by x.sequence desc limit 1) m on true
    where r.status='accepted' and actor in (r.requester_id,r.recipient_id) and (p_before is null or r.id<p_before)
    order by r.id desc limit p_limit;
end;
$$;

-- The service key may call these two RPCs only. Queue rows, presence and auth
-- e-mail addresses are never readable through a member token or the REST tables.
create function public.messaging_claim_notifications(p_limit integer default 20)
returns table(job_id uuid,lease_token uuid,recipient_id uuid,conversation_id uuid,email text,unread_count bigint)
language plpgsql security definer set search_path = '' as $$
declare job private.messaging_email_queue; member private.messaging_members;
  unread bigint; latest bigint; email_address text; token uuid; claimed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid batch size' using errcode='22023'; end if;
  if private.maintenance_active() then return; end if;
  -- Serialize budget reservations; never consume a paid email tier automatically.
  if not pg_try_advisory_xact_lock(hashtextextended('messaging:email-budget',0)) then return; end if;
  for job in select q.* from private.messaging_email_queue q
    where q.status in ('pending','processing') and q.next_attempt_at<=clock_timestamp()
      and (q.lease_until is null or q.lease_until<=clock_timestamp())
    order by q.next_attempt_at,q.id for update skip locked
  loop
    exit when claimed>=p_limit;
    select * into member from private.messaging_members mm where mm.user_id=job.recipient_id for update skip locked;
    if not found then continue; end if;
    select u.email into email_address from auth.users u join public.profiles p on p.id=u.id
      where u.id=job.recipient_id and p.is_active and p.profile_completed
        and not exists(select 1 from private.hub_suspensions s where s.user_id=p.id);
    select count(*),max(m.sequence) into unread,latest from public.conversation_messages m
      where m.conversation_id=job.conversation_id and m.recipient_id=job.recipient_id and m.read_at is null;
    if unread=0 or not member.email_enabled or nullif(email_address,'') is null then
      update private.messaging_email_queue q set status='cancelled',finished_at=clock_timestamp(),lease_until=null
        where q.id=job.id;
      update private.messaging_members set delivery_lease_until=null,delivery_job_id=null
        where user_id=job.recipient_id and delivery_job_id=job.id;
      continue;
    end if;
    -- Brevo retains idempotency keys for 30 minutes. Expire ambiguous attempts
    -- before that window, rather than risking a duplicate after a delayed run.
    if job.attempts>=5 or job.first_attempt_at<=clock_timestamp()-interval '25 minutes' then
      update private.messaging_email_queue q set status='failed',finished_at=clock_timestamp(),lease_until=null where q.id=job.id;
      update private.messaging_members set delivery_lease_until=null,delivery_job_id=null
        where user_id=job.recipient_id and delivery_job_id=job.id;
      continue;
    end if;
    if member.last_seen_at>clock_timestamp()-interval '2 minutes'
      or member.last_emailed_at>clock_timestamp()-interval '1 hour'
      or member.delivery_lease_until>clock_timestamp() then continue; end if;
    if job.first_attempt_at is null and (select count(*) from private.messaging_email_queue q
      where q.first_attempt_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')>=180 then
      continue;
    end if;
    token := gen_random_uuid();
    update private.messaging_email_queue q set status='processing',attempts=q.attempts+1,first_attempt_at=coalesce(q.first_attempt_at,clock_timestamp()),
      lease_token=token,lease_until=clock_timestamp()+interval '5 minutes',
      through_sequence=coalesce(q.through_sequence,latest),notification_unread_count=coalesce(q.notification_unread_count,unread) where q.id=job.id;
    update private.messaging_members set delivery_lease_until=clock_timestamp()+interval '5 minutes',delivery_job_id=job.id
      where user_id=job.recipient_id;
    job_id:=job.id; lease_token:=token; recipient_id:=job.recipient_id;
    conversation_id:=job.conversation_id; email:=email_address; unread_count:=coalesce(job.notification_unread_count,unread);
    claimed:=claimed+1; return next;
  end loop;
end;
$$;
create function public.messaging_finish_notification(p_job_id uuid,p_lease_token uuid,p_success boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare job private.messaging_email_queue;
begin
  if p_success is null then raise exception 'Delivery result is required' using errcode='22023'; end if;
  select * into job from private.messaging_email_queue where id=p_job_id for update;
  if not found or job.status<>'processing' or job.lease_token is distinct from p_lease_token
    or job.lease_until<=clock_timestamp() then
    raise exception 'Notification lease is no longer valid' using errcode='42501'; end if;
  update private.messaging_members set delivery_lease_until=null,delivery_job_id=null,
    last_emailed_at=case when p_success then clock_timestamp() else last_emailed_at end
    where user_id=job.recipient_id and delivery_job_id=job.id;
  update private.messaging_email_queue set
    status=case when p_success then 'sent' when attempts>=5 then 'failed' else 'pending' end,
    finished_at=case when p_success or attempts>=5 then clock_timestamp() end,
    next_attempt_at=clock_timestamp()+make_interval(mins=>least(60,(2^job.attempts)::integer)),
    lease_until=null,lease_token=null where id=job.id;
  if p_success and exists(select 1 from public.conversation_messages where conversation_id=job.conversation_id
    and recipient_id=job.recipient_id and read_at is null and sequence>job.through_sequence) then
    insert into private.messaging_email_queue(recipient_id,conversation_id) values(job.recipient_id,job.conversation_id)
      on conflict(recipient_id,conversation_id) where status in ('pending','processing') do nothing;
  end if;
end;
$$;

revoke all on function private.require_messaging_member() from public,anon,authenticated,service_role;
revoke all on function public.messaging_send_message(uuid,text,uuid),public.messaging_mark_read(uuid,bigint),
  public.messaging_heartbeat(),public.messaging_email_enabled(),public.messaging_set_email_enabled(boolean),
  public.messaging_unread_count(),public.messaging_list_conversations(uuid,integer),
  public.messaging_claim_notifications(integer),public.messaging_finish_notification(uuid,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.messaging_send_message(uuid,text,uuid),public.messaging_mark_read(uuid,bigint),
  public.messaging_heartbeat(),public.messaging_email_enabled(),public.messaging_set_email_enabled(boolean),
  public.messaging_unread_count(),public.messaging_list_conversations(uuid,integer) to authenticated;
grant execute on function public.messaging_claim_notifications(integer),public.messaging_finish_notification(uuid,uuid,boolean) to service_role;

-- Supabase installs this publication; the local SQL harness deliberately does not.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='conversation_messages') then
      alter publication supabase_realtime add table public.conversation_messages;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='connection_requests') then
      alter publication supabase_realtime add table public.connection_requests;
    end if;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
