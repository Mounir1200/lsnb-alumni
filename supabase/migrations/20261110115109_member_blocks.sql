begin;

-- A member may block another one. Neither can then send the other a request or a
-- message, and every link between them ends at once. The blocked member is never
-- told: only the blocker can read or lift the block.
create table public.member_blocks (
  blocker_id uuid not null constraint member_blocks_blocker_id_fkey references public.profiles(id) on delete cascade,
  blocked_id uuid not null constraint member_blocks_blocked_id_fkey references public.profiles(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  constraint member_blocks_pkey primary key (blocker_id, blocked_id),
  constraint member_blocks_distinct_members check (blocker_id <> blocked_id)
);
create index member_blocks_blocked_idx on public.member_blocks(blocked_id);

comment on table public.member_blocks is
  'Blocks made by members. Only the blocker reads or lifts a block; block_member() is the only way to add one.';

-- True when either member has blocked the other.
create function private.members_blocked(p_first uuid, p_second uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.member_blocks b
    where (b.blocker_id = p_first and b.blocked_id = p_second) or (b.blocker_id = p_second and b.blocked_id = p_first));
$$;

-- Blocks, then ends what links the pair: the blocked member's pending requests are
-- declined (their announcement emails are then skipped), the blocker's are withdrawn,
-- the connection is removed and active mentorships end, signed by the blocker. Each
-- step runs under the blocker's own rights checks. Running it again changes nothing.
create function public.block_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or private.site_allowed() is distinct from true then
    raise exception 'Site unavailable or account suspended' using errcode = '42501';
  end if;
  if p_member_id = actor then raise exception 'You cannot block yourself' using errcode = 'LS422'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  insert into public.member_blocks (blocker_id, blocked_id) values (actor, p_member_id) on conflict do nothing;
  update public.connection_requests set status = 'declined'::public.connection_request_status
    where requester_id = p_member_id and recipient_id = actor and status = 'pending'::public.connection_request_status;
  delete from public.connection_requests
    where requester_id = actor and recipient_id = p_member_id and status = 'pending'::public.connection_request_status;
  delete from public.member_connections
    where member_a = least(actor, p_member_id) and member_b = greatest(actor, p_member_id);
  update public.mentorships set ended_at = clock_timestamp()
    where ended_at is null
      and ((mentor_id = actor and mentee_id = p_member_id) or (mentor_id = p_member_id and mentee_id = actor));
end;
$$;

-- Neither member of a blocked pair can ask the other anything; declining stays possible.
create function private.guard_blocked_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.status = 'accepted'::public.connection_request_status)
    and private.members_blocked(new.requester_id, new.recipient_id) then
    raise exception 'One of these members has blocked the other' using errcode = 'LS423';
  end if;
  return new;
end;
$$;
create trigger guard_blocked_request before insert or update of status on public.connection_requests
for each row execute function private.guard_blocked_request();

-- Messages between a blocked pair are refused, whatever inserts them.
create function private.guard_blocked_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.members_blocked(new.sender_id, new.recipient_id) then
    raise exception 'One of these members has blocked the other' using errcode = 'LS423';
  end if;
  return new;
end;
$$;
create trigger guard_blocked_message before insert on public.conversation_messages
for each row execute function private.guard_blocked_message();

revoke all on function private.members_blocked(uuid, uuid), private.guard_blocked_request(), private.guard_blocked_message()
  from public, anon, authenticated, service_role;
revoke all on function public.block_member(uuid) from public, anon, authenticated, service_role;
grant execute on function public.block_member(uuid) to authenticated;

alter table public.member_blocks enable row level security;
create policy "Members read the blocks they made" on public.member_blocks for select to authenticated
using (blocker_id = (select auth.uid()));
create policy "Members lift the blocks they made" on public.member_blocks for delete to authenticated
using (blocker_id = (select auth.uid()));
create policy hub_site_gate on public.member_blocks as restrictive for all to authenticated
using ((select private.site_allowed())) with check ((select private.site_allowed()));

revoke all on public.member_blocks from public, anon, authenticated;
grant select, delete on public.member_blocks to authenticated;

notify pgrst, 'reload schema';

commit;
