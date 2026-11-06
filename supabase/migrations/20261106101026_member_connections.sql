begin;

-- Members connect with each other whatever their role, as in a professional
-- network. An accepted 'connection' request creates one shared row per pair;
-- like any accepted request, it also opens the private conversation.
create table public.member_connections (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null constraint member_connections_member_a_fkey references public.profiles(id) on delete cascade,
  member_b uuid not null constraint member_connections_member_b_fkey references public.profiles(id) on delete cascade,
  request_id uuid not null unique constraint member_connections_request_id_fkey references public.connection_requests(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  -- One row per pair whoever asked: the smaller id always comes first.
  constraint member_connections_ordered_pair check (member_a < member_b)
);
create unique index member_connections_pair_unique_idx on public.member_connections(member_a, member_b);
create index member_connections_member_b_idx on public.member_connections(member_b, created_at desc);

comment on table public.member_connections is
  'Accepted peer connections between members of any role. Only the two members can see or remove them.';

-- Same rules as before for contact and mentoring requests. A connection, like
-- a contact, only needs two active completed members; acceptance is refused
-- when the pair is already connected.
create or replace function private.guard_connection_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  requester_eligible boolean;
  recipient_eligible boolean;
begin
  -- ON DELETE SET NULL runs as the table owner, also when an account deletion
  -- cascades without a member session. Clients cannot write offer_id (column
  -- grants), so a change limited to clearing it can only come from that cascade.
  if tg_op = 'UPDATE' and old.offer_id is not null and new.offer_id is null
    and to_jsonb(new) - 'offer_id' = to_jsonb(old) - 'offer_id' then
    return new;
  end if;

  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.requester_id is distinct from actor_id then
      raise exception 'Only the requester can send a request' using errcode = '42501';
    end if;
    if new.status is distinct from 'pending'::public.connection_request_status or new.responded_at is not null then
      raise exception 'New requests must be pending without a response' using errcode = '22023';
    end if;
    -- Invoker rights: the requester can only reference an offer they can read.
    if new.offer_id is not null and (
      new.request_kind is distinct from 'contact'::public.connection_request_kind
      or not exists (select 1 from public.offers o where o.id = new.offer_id and o.author_id = new.recipient_id)
    ) then
      raise exception 'An offer question must be a contact request to its author' using errcode = '22023';
    end if;
    new.id := gen_random_uuid();
    new.created_at := clock_timestamp();
    new.message := btrim(new.message);
  else
    if old.recipient_id is distinct from actor_id then
      raise exception 'Only the recipient can answer a request' using errcode = '42501';
    end if;
    if old.status <> 'pending'::public.connection_request_status
      or new.status not in ('accepted'::public.connection_request_status, 'declined'::public.connection_request_status) then
      raise exception 'Only pending requests can be accepted or declined' using errcode = '22023';
    end if;
    if new.id is distinct from old.id or new.requester_id is distinct from old.requester_id
      or new.recipient_id is distinct from old.recipient_id or new.request_kind is distinct from old.request_kind
      or new.message is distinct from old.message or new.created_at is distinct from old.created_at
      or new.responded_at is distinct from old.responded_at or new.offer_id is distinct from old.offer_id then
      raise exception 'Only the request status can be changed' using errcode = '22023';
    end if;
    new.responded_at := clock_timestamp();
    -- A recipient may refuse even after disabling their account or mentoring.
    if new.status = 'declined'::public.connection_request_status then return new; end if;
  end if;

  if new.requester_id = new.recipient_id then
    raise exception 'You cannot send yourself a request' using errcode = '22023';
  end if;
  select p.is_active and p.profile_completed into requester_eligible
    from public.profiles p where p.id = new.requester_id;
  select p.is_active and p.profile_completed
      and (new.request_kind in ('contact'::public.connection_request_kind, 'connection'::public.connection_request_kind)
        or (p.member_role = 'alumni'::public.member_role and p.offers_mentoring))
    into recipient_eligible from public.profiles p where p.id = new.recipient_id;
  if requester_eligible is distinct from true or recipient_eligible is distinct from true then
    raise exception 'Both members must have active completed profiles and the mentor must offer mentoring'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.request_kind = 'mentoring'::public.connection_request_kind then
    -- Serialize acceptance/ending for the same directional pair. INSERT takes
    -- this lock AFTER its unique-index checks, avoiding an inverted lock order.
    perform pg_advisory_xact_lock(hashtextextended('mentorship:' || new.recipient_id::text || ':' || new.requester_id::text, 0));
    if exists (select 1 from public.mentorships m
      where m.mentor_id = new.recipient_id and m.mentee_id = new.requester_id and m.ended_at is null) then
      raise exception 'An active mentorship already exists' using errcode = '23505';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.request_kind = 'connection'::public.connection_request_kind then
    perform pg_advisory_xact_lock(hashtextextended('connection:' || least(new.requester_id, new.recipient_id)::text
      || ':' || greatest(new.requester_id, new.recipient_id)::text, 0));
    if exists (select 1 from public.member_connections c
      where c.member_a = least(new.requester_id, new.recipient_id)
        and c.member_b = greatest(new.requester_id, new.recipient_id)) then
      raise exception 'These members are already connected' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

-- Runs after the pending-request unique index, then serializes the pair: a
-- request crossing another one, or arriving once connected, is rolled back.
-- Both members of the pair can read their own connection and requests (RLS).
create function private.guard_pending_connection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.request_kind = 'connection'::public.connection_request_kind then
    perform pg_advisory_xact_lock(hashtextextended('connection:' || least(new.requester_id, new.recipient_id)::text
      || ':' || greatest(new.requester_id, new.recipient_id)::text, 0));
    if exists (select 1 from public.member_connections c
      where c.member_a = least(new.requester_id, new.recipient_id)
        and c.member_b = greatest(new.requester_id, new.recipient_id)) then
      raise exception 'These members are already connected' using errcode = '23505';
    end if;
    if exists (select 1 from public.connection_requests r
      where r.requester_id = new.recipient_id and r.recipient_id = new.requester_id
        and r.request_kind = 'connection'::public.connection_request_kind
        and r.status = 'pending'::public.connection_request_status) then
      raise exception 'A connection request from this member is already waiting for your answer' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_pending_connection
after insert on public.connection_requests
for each row execute function private.guard_pending_connection();

-- The only elevated write: the recipient already passed the invoker guard and RLS.
create function private.create_accepted_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending'::public.connection_request_status
    and new.status = 'accepted'::public.connection_request_status
    and new.request_kind = 'connection'::public.connection_request_kind then
    if auth.uid() is distinct from new.recipient_id then
      raise exception 'Only the recipient can accept a connection' using errcode = '42501';
    end if;
    insert into public.member_connections (member_a, member_b, request_id)
      values (least(new.requester_id, new.recipient_id), greatest(new.requester_id, new.recipient_id), new.id);
  end if;
  return new;
end;
$$;

create trigger create_accepted_connection
after update of status on public.connection_requests
for each row execute function private.create_accepted_connection();

revoke all on function private.guard_connection_request() from public, anon, authenticated, service_role;
revoke all on function private.guard_pending_connection() from public, anon, authenticated, service_role;
revoke all on function private.create_accepted_connection() from public, anon, authenticated, service_role;

alter table public.member_connections enable row level security;
create policy "Members read their own connections"
on public.member_connections for select to authenticated
using (member_a = (select auth.uid()) or member_b = (select auth.uid()));
create policy "Members remove their own connections"
on public.member_connections for delete to authenticated
using (member_a = (select auth.uid()) or member_b = (select auth.uid()));
create policy hub_site_gate on public.member_connections as restrictive for all to authenticated
using ((select private.site_allowed())) with check ((select private.site_allowed()));

revoke all on public.member_connections from public, anon, authenticated;
grant select, delete on public.member_connections to authenticated;

notify pgrst, 'reload schema';

commit;
