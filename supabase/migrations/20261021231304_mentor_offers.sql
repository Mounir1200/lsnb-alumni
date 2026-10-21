begin;

-- Mentors share internships, scholarships and university admissions. Members
-- ask about an offer through an ordinary contact request that references it.
create type public.offer_kind as enum ('internship', 'scholarship', 'admission');

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null constraint offers_author_id_fkey references public.profiles(id) on delete cascade,
  kind public.offer_kind not null,
  title text not null constraint offers_title_check check (char_length(title) between 5 and 120),
  organization text not null constraint offers_organization_check check (char_length(organization) between 2 and 120),
  location text not null default '' constraint offers_location_check check (char_length(location) <= 120),
  description text not null constraint offers_description_check check (char_length(description) between 30 and 3000),
  -- Same public HTTPS rules as portfolio links: no local names or private IPs.
  link_url text constraint offers_link_url_check check (public.is_valid_profile_link(link_url, false)),
  deadline date,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index offers_author_idx on public.offers(author_id, created_at desc);

comment on table public.offers is
  'Opportunities published by active alumni mentors. Visible to active completed members while the author still offers mentoring; the author always sees and manages their own.';

alter table public.connection_requests
  add column offer_id uuid constraint connection_requests_offer_id_fkey references public.offers(id) on delete set null;
create index connection_requests_offer_idx on public.connection_requests(offer_id) where offer_id is not null;

comment on column public.connection_requests.offer_id is
  'Offer a contact request asks about. Detached (null) when the author deletes the offer; the request and its message remain.';

create function private.guard_offer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  author_eligible boolean;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if new.author_id is distinct from actor_id then
    raise exception 'Only the author can publish or edit an offer' using errcode = '42501';
  end if;

  new.title := btrim(new.title);
  new.organization := btrim(new.organization);
  new.location := btrim(new.location);
  new.description := btrim(new.description);
  new.link_url := nullif(btrim(new.link_url), '');

  if tg_op = 'INSERT' then
    select p.is_active and p.profile_completed
        and p.member_role = 'alumni'::public.member_role and p.offers_mentoring
      into author_eligible from public.profiles p where p.id = actor_id;
    if author_eligible is distinct from true then
      raise exception 'Only active alumni who offer mentoring can publish offers' using errcode = '42501';
    end if;
    new.id := gen_random_uuid();
    new.created_at := clock_timestamp();
    if new.deadline < current_date then
      raise exception 'The deadline cannot be in the past' using errcode = '22023';
    end if;
  else
    if new.id is distinct from old.id or new.author_id is distinct from old.author_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Only the offer content can be changed' using errcode = '22023';
    end if;
    -- An expired offer stays editable as long as its deadline is left unchanged.
    if new.deadline < current_date and new.deadline is distinct from old.deadline then
      raise exception 'The deadline cannot be in the past' using errcode = '22023';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger guard_offer
before insert or update on public.offers
for each row execute function private.guard_offer();

revoke all on function private.guard_offer() from public, anon, authenticated, service_role;

-- Replaces the mentoring version with two additions: detaching a deleted offer,
-- and checking that an offer question targets that offer's author.
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

revoke all on function private.guard_connection_request() from public, anon, authenticated, service_role;

alter table public.offers enable row level security;

create policy "Members can read published offers and authors their own"
on public.offers for select to authenticated
using (
  author_id = (select auth.uid())
  or (
    exists (select 1 from public.profiles viewer where viewer.id = (select auth.uid()) and viewer.is_active and viewer.profile_completed)
    and exists (select 1 from public.profiles author where author.id = author_id
      and author.is_active and author.profile_completed
      and author.member_role = 'alumni'::public.member_role and author.offers_mentoring)
  )
);
create policy "Mentors can publish their offers"
on public.offers for insert to authenticated
with check (author_id = (select auth.uid()));
create policy "Authors can edit their offers"
on public.offers for update to authenticated
using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()));
create policy "Authors can delete their offers"
on public.offers for delete to authenticated
using (author_id = (select auth.uid()));

revoke all on public.offers from public, anon, authenticated;
grant select, delete on public.offers to authenticated;
grant insert (author_id, kind, title, organization, location, description, link_url, deadline) on public.offers to authenticated;
grant update (kind, title, organization, location, description, link_url, deadline) on public.offers to authenticated;

notify pgrst, 'reload schema';

commit;
