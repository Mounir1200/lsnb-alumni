begin;

-- Messages stay in connection_requests, readable only by their participants.
-- Only mutually accepted mentoring produces a network relationship.
create table public.mentorships (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null constraint mentorships_mentor_id_fkey references public.profiles(id) on delete cascade,
  mentee_id uuid not null constraint mentorships_mentee_id_fkey references public.profiles(id) on delete cascade,
  request_id uuid not null unique constraint mentorships_request_id_fkey references public.connection_requests(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  ended_by uuid constraint mentorships_ended_by_fkey references public.profiles(id) on delete cascade,
  constraint mentorships_distinct_members check (mentor_id <> mentee_id),
  constraint mentorships_ending_pair check ((ended_at is null) = (ended_by is null)),
  constraint mentorships_ending_participant check (ended_by is null or ended_by in (mentor_id, mentee_id)),
  constraint mentorships_ending_time check (ended_at is null or ended_at >= created_at)
);

create unique index mentorships_active_pair_unique_idx
  on public.mentorships(mentor_id, mentee_id) where ended_at is null;
create index mentorships_mentor_history_idx on public.mentorships(mentor_id, created_at desc);
create index mentorships_mentee_history_idx on public.mentorships(mentee_id, created_at desc);
create index connection_requests_requester_idx on public.connection_requests(requester_id, created_at desc);
create unique index connection_requests_contact_open_unique_idx
  on public.connection_requests(requester_id, recipient_id)
  where request_kind = 'contact' and status in ('pending', 'accepted');

comment on table public.mentorships is
  'Accepted mentoring relationships. Members can see the active network; only participants can see ended relationships. Request messages remain private.';

-- Historical accepted requests were not protected against spoofed consent.
-- Do not silently treat them as verified relationships on other installations.
do $$
begin
  if exists (select 1 from public.connection_requests where request_kind = 'mentoring' and status = 'accepted') then
    raise exception 'Review existing accepted mentoring requests before applying this migration; consent was not previously enforced';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.guard_connection_request()
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
      or new.responded_at is distinct from old.responded_at then
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
      and (new.request_kind = 'contact'::public.connection_request_kind
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
  return new;
end;
$$;

drop trigger protect_connection_request_update on public.connection_requests;
drop function public.protect_connection_request_update();
create trigger guard_connection_request
before insert or update on public.connection_requests
for each row execute function private.guard_connection_request();

create function private.guard_pending_mentorship()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.request_kind = 'mentoring'::public.connection_request_kind then
    -- A competing acceptance may have committed while this INSERT waited on
    -- the pending-request unique index. Check the active relationship after
    -- that wait, and roll back this INSERT if the pair is already connected.
    perform pg_advisory_xact_lock(hashtextextended('mentorship:' || new.recipient_id::text || ':' || new.requester_id::text, 0));
    if exists (select 1 from public.mentorships m
      where m.mentor_id = new.recipient_id and m.mentee_id = new.requester_id and m.ended_at is null) then
      raise exception 'An active mentorship already exists' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_pending_mentorship
after insert on public.connection_requests
for each row execute function private.guard_pending_mentorship();

-- This is the only elevated write: the authenticated recipient already passed
-- the invoker guard and RLS. No client can insert a mentorship directly.
create function private.create_accepted_mentorship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending'::public.connection_request_status
    and new.status = 'accepted'::public.connection_request_status
    and new.request_kind = 'mentoring'::public.connection_request_kind then
    if auth.uid() is distinct from new.recipient_id then
      raise exception 'Only the recipient can accept mentoring' using errcode = '42501';
    end if;
    insert into public.mentorships (mentor_id, mentee_id, request_id)
      values (new.recipient_id, new.requester_id, new.id);
  end if;
  return new;
end;
$$;

create trigger create_accepted_mentorship
after update of status on public.connection_requests
for each row execute function private.create_accepted_mentorship();

create function private.guard_mentorship_ending()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or actor_id not in (old.mentor_id, old.mentee_id) then
    raise exception 'Only participants can end a mentorship' using errcode = '42501';
  end if;
  if old.ended_at is not null or new.ended_at is null then
    raise exception 'Only an active mentorship can be ended' using errcode = '22023';
  end if;
  if new.id is distinct from old.id or new.mentor_id is distinct from old.mentor_id
    or new.mentee_id is distinct from old.mentee_id or new.request_id is distinct from old.request_id
    or new.created_at is distinct from old.created_at or new.ended_by is distinct from old.ended_by then
    raise exception 'Only the ending of a mentorship can be changed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mentorship:' || old.mentor_id::text || ':' || old.mentee_id::text, 0));
  new.ended_at := clock_timestamp();
  new.ended_by := actor_id;
  return new;
end;
$$;

create trigger guard_mentorship_ending
before update on public.mentorships
for each row execute function private.guard_mentorship_ending();

revoke all on function private.guard_connection_request() from public, anon, authenticated, service_role;
revoke all on function private.guard_pending_mentorship() from public, anon, authenticated, service_role;
revoke all on function private.create_accepted_mentorship() from public, anon, authenticated, service_role;
revoke all on function private.guard_mentorship_ending() from public, anon, authenticated, service_role;

-- Requests remain private, including when the resulting relationship is visible.
drop policy "Members can create connection requests" on public.connection_requests;
create policy "Members can create connection requests"
on public.connection_requests for insert to authenticated
with check (requester_id = (select auth.uid()) and status = 'pending' and responded_at is null);
drop policy "Recipients can answer connection requests" on public.connection_requests;
create policy "Recipients can answer connection requests"
on public.connection_requests for update to authenticated
using (recipient_id = (select auth.uid()) and status = 'pending')
with check (recipient_id = (select auth.uid()) and status in ('accepted', 'declined'));

revoke all on public.connection_requests from anon, authenticated;
grant select, insert, delete on public.connection_requests to authenticated;
grant update (status) on public.connection_requests to authenticated;

alter table public.mentorships enable row level security;
create policy "Members can read active network and participants their history"
on public.mentorships for select to authenticated
using (
  mentor_id = (select auth.uid()) or mentee_id = (select auth.uid())
  or (
    ended_at is null
    and exists (select 1 from public.profiles viewer where viewer.id = (select auth.uid()) and viewer.is_active and viewer.profile_completed)
    and exists (select 1 from public.profiles mentor where mentor.id = mentor_id and mentor.is_active and mentor.profile_completed)
    and exists (select 1 from public.profiles mentee where mentee.id = mentee_id and mentee.is_active and mentee.profile_completed)
  )
);
create policy "Participants can end active mentorships"
on public.mentorships for update to authenticated
using (ended_at is null and (mentor_id = (select auth.uid()) or mentee_id = (select auth.uid())))
with check (ended_by = (select auth.uid()) and ended_at is not null
  and (mentor_id = (select auth.uid()) or mentee_id = (select auth.uid())));

revoke all on public.mentorships from public, anon, authenticated;
grant select on public.mentorships to authenticated;
grant update (ended_at) on public.mentorships to authenticated;

notify pgrst, 'reload schema';

commit;
