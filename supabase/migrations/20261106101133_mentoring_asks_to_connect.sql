begin;

-- A mentoring request also asks to connect; a connection request asks for
-- nothing else. Between two members who are not connected yet, a mentoring
-- request comes with a connection request from the same member, with the same
-- message, in the same transaction.
--
-- Accepting the mentoring connects the pair through the mentoring request
-- itself: every accepted request opens its own conversation, so accepting the
-- connection request as well would give the pair two. Declining the mentoring
-- leaves the connection request to be answered on its own.

-- Invoker rights: the connection request is the requester's own insert, held to
-- the same guards and policies as any request they send.
create function private.ask_to_connect_with_mentoring()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.member_connections c
      where c.member_a = least(new.requester_id, new.recipient_id)
        and c.member_b = greatest(new.requester_id, new.recipient_id))
    and not exists (select 1 from public.connection_requests r
      where r.request_kind = 'connection'::public.connection_request_kind
        and r.status = 'pending'::public.connection_request_status
        and r.requester_id in (new.requester_id, new.recipient_id)
        and r.recipient_id in (new.requester_id, new.recipient_id)) then
    insert into public.connection_requests (requester_id, recipient_id, request_kind, message)
      values (new.requester_id, new.recipient_id, 'connection'::public.connection_request_kind, new.message);
  end if;
  return new;
end;
$$;

create trigger ask_to_connect_with_mentoring
after insert on public.connection_requests
for each row when (new.request_kind = 'mentoring'::public.connection_request_kind)
execute function private.ask_to_connect_with_mentoring();

-- Owner rights, like the accepted connection: clients cannot write connections.
-- A connection request still pending between the pair has nothing left to ask.
create function private.connect_through_mentoring()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from new.recipient_id then
    raise exception 'Only the recipient can accept a mentoring request' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('connection:' || least(new.requester_id, new.recipient_id)::text
    || ':' || greatest(new.requester_id, new.recipient_id)::text, 0));
  delete from public.connection_requests r
    where r.request_kind = 'connection'::public.connection_request_kind
      and r.status = 'pending'::public.connection_request_status
      and r.requester_id in (new.requester_id, new.recipient_id)
      and r.recipient_id in (new.requester_id, new.recipient_id);
  insert into public.member_connections (member_a, member_b, request_id)
    values (least(new.requester_id, new.recipient_id), greatest(new.requester_id, new.recipient_id), new.id)
    on conflict (member_a, member_b) do nothing;
  return new;
end;
$$;

create trigger connect_through_mentoring
after update of status on public.connection_requests
for each row when (old.status = 'pending'::public.connection_request_status
  and new.status = 'accepted'::public.connection_request_status
  and new.request_kind = 'mentoring'::public.connection_request_kind)
execute function private.connect_through_mentoring();

-- Same queue as before, with one exception: the connection asked along with a
-- mentoring request is announced by the mentoring email, not by a second one.
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

-- Members already in an active mentorship are connected through it.
insert into public.member_connections (member_a, member_b, request_id)
select least(m.mentor_id, m.mentee_id), greatest(m.mentor_id, m.mentee_id), m.request_id
from public.mentorships m
where m.ended_at is null
on conflict do nothing;

revoke all on function private.ask_to_connect_with_mentoring() from public, anon, authenticated, service_role;
revoke all on function private.connect_through_mentoring() from public, anon, authenticated, service_role;

commit;
