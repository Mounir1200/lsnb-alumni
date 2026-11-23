begin;

-- Erasing an account cannot be undone, yet any session left open, on a shared
-- computer or with a copied token, could do it at once; the typed confirmation
-- only existed in the site. The site also removed the photo itself, first:
-- a suspended member, held back by the storage gate, could not erase their
-- account at all, and a deletion made another way left the photo public
-- (audit of 21 November, M5). The database now decides alone.

-- The sign-in behind this request is still open and less than ten minutes
-- old, the rule for adding a messaging device (public.messaging_register_device).
create function private.signed_in_recently() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare current_session uuid;
begin
  begin current_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then return false; end;
  return current_session is not null and exists (select 1 from auth.sessions s
    where s.id = current_session and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > clock_timestamp())
      and s.created_at >= clock_timestamp() - interval '10 minutes');
end;
$$;

-- Someone must keep the keys of the hub: the last super administrator can
-- neither step down nor erase their account.
create function private.is_last_super_admin(p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.hub_staff s where s.user_id = p_member and s.role = 'super_admin')
    and not exists (select 1 from private.hub_staff s where s.role = 'super_admin' and s.user_id <> p_member);
$$;

-- Why the account cannot be erased right now, or null when it can. A rule the
-- member cannot lift by signing in again comes first.
create function private.account_deletion_blocker(p_actor uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when private.is_last_super_admin(p_actor) then 'last_super_admin'
    when not private.signed_in_recently() then 'sign_in_again' end;
$$;

-- What the site shows before the member types the confirmation word.
create function public.account_deletion_status() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to delete your account' using errcode = '42501'; end if;
  return coalesce(private.account_deletion_blocker(auth.uid()), 'ready');
end;
$$;

-- The existing cascades still take the profile and everything tied to it;
-- reports the member filed stay, without their name. The team's lock keeps
-- two super administrators from both leaving at once.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); blocker text;
begin
  if actor is null then raise exception 'Sign in to delete your account' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hub:administration', 0));
  blocker := private.account_deletion_blocker(actor);
  if blocker = 'last_super_admin' then
    raise exception 'The last super administrator cannot delete their account' using errcode = 'LS409'; end if;
  if blocker = 'sign_in_again' then
    raise exception 'A recent sign-in is required to delete your account' using errcode = 'LS428'; end if;
  delete from auth.users where id = actor;
end;
$$;

create or replace function public.hub_leave_team() returns void language plpgsql security definer set search_path = '' as $$
declare staff private.hub_staff;
begin
  perform pg_advisory_xact_lock(hashtextextended('hub:administration',0));
  staff := private.require_staff();
  if private.is_last_super_admin(staff.user_id) then
    raise exception 'The last super administrator cannot leave the team' using errcode = '42501'; end if;
  delete from private.hub_staff where user_id = staff.user_id;
  perform private.audit_action('staff_changed',staff.user_id,staff.graduation_year,concat('Role: ',staff.role,' → member (stepped down)'));
end;
$$;

-- The photo lives in Storage, outside the cascades, and only the Storage API
-- may remove it. Whatever erases a profile (the member, the dashboard) leaves
-- one job here, which the API's next round carries out with its own key
-- (api/src/accounts/avatarRemoval.ts), like an e-mail: under a lease, retried
-- with a growing delay, given up after eight attempts.
create table private.avatar_removal_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'failed')),
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts between 0 and 8),
  lease_token uuid,
  lease_until timestamptz
);
create index avatar_removal_queue_due_idx on private.avatar_removal_queue(next_attempt_at) where status in ('pending', 'processing');
alter table private.avatar_removal_queue enable row level security;
revoke all on private.avatar_removal_queue from public, anon, authenticated, service_role;

create function private.queue_avatar_removal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.avatar_removal_queue (owner_id) values (old.id) on conflict (owner_id) do nothing;
  return null;
end;
$$;
create trigger queue_avatar_removal after delete on public.profiles
for each row execute function private.queue_avatar_removal();

-- A queued photo starts a round at once, as request e-mails do; a retry waits
-- for a later round. (Comparing next_attempt_at with now(), the transaction's
-- start, would never fire: the row is written after the transaction began.)
create trigger start_avatar_removal_round after insert on private.avatar_removal_queue
for each row execute function private.start_notification_round();

create function public.claim_avatar_removals(p_limit integer default 5)
returns table(job_id uuid, lease_token uuid, owner_id uuid)
language plpgsql security definer set search_path = '' as $$
declare job private.avatar_removal_queue; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid batch size' using errcode = '22023'; end if;
  for job in select q.* from private.avatar_removal_queue q
    where q.status in ('pending', 'processing') and q.attempts < 8 and q.next_attempt_at <= clock_timestamp()
      and (q.lease_until is null or q.lease_until <= clock_timestamp())
    order by q.next_attempt_at, q.id limit p_limit for update skip locked
  loop
    token := gen_random_uuid();
    update private.avatar_removal_queue q set status = 'processing', attempts = q.attempts + 1,
      lease_token = token, lease_until = clock_timestamp() + interval '5 minutes'
      where q.id = job.id;
    job_id := job.id; lease_token := token; owner_id := job.owner_id;
    return next;
  end loop;
end;
$$;

-- A removed photo leaves nothing behind, not even the erased account's id.
create function public.finish_avatar_removal(p_job_id uuid, p_lease_token uuid, p_success boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare job private.avatar_removal_queue;
begin
  if p_success is null then raise exception 'Removal result is required' using errcode = '22023'; end if;
  select * into job from private.avatar_removal_queue where id = p_job_id for update;
  if not found or job.status <> 'processing' or job.lease_token is distinct from p_lease_token
    or job.lease_until <= clock_timestamp() then
    raise exception 'Removal lease is no longer valid' using errcode = '42501';
  end if;
  if p_success then
    delete from private.avatar_removal_queue where id = job.id;
    return;
  end if;
  update private.avatar_removal_queue set
    status = case when job.attempts >= 8 then 'failed' else 'pending' end,
    next_attempt_at = clock_timestamp() + make_interval(mins => least(60, (2 ^ job.attempts)::integer)),
    lease_until = null, lease_token = null
    where id = job.id;
end;
$$;

revoke all on function private.signed_in_recently(), private.is_last_super_admin(uuid), private.account_deletion_blocker(uuid),
  public.account_deletion_status(), private.queue_avatar_removal(),
  public.claim_avatar_removals(integer), public.finish_avatar_removal(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.account_deletion_status() to authenticated;
grant execute on function public.claim_avatar_removals(integer), public.finish_avatar_removal(uuid, uuid, boolean) to service_role;

notify pgrst, 'reload schema';

commit;
