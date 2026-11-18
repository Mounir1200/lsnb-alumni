begin;

-- Blocking and asking must not interleave. The check refusing a request between
-- a blocked pair ran before the new request could wait for a pending one that a
-- block was declining, and nothing ran it again: a request sent while a block
-- was being written could outlive it, with its introduction and its e-mail.
-- Both now take one lock per pair of members, so a new request waits for the
-- block and then sees it, or the block waits for the request and then ends it.
create function private.lock_member_pair(p_first uuid, p_second uuid) returns void
language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(
    'members:pair:' || least(p_first, p_second)::text || ':' || greatest(p_first, p_second)::text, 0));
$$;
revoke all on function private.lock_member_pair(uuid, uuid) from public, anon, authenticated, service_role;

-- An acceptance needs no lock: block_member writes the request's own row first.
create or replace function private.guard_blocked_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then perform private.lock_member_pair(new.requester_id, new.recipient_id); end if;
  if (tg_op = 'INSERT' or new.status = 'accepted'::public.connection_request_status)
    and private.members_blocked(new.requester_id, new.recipient_id) then
    raise exception 'One of these members has blocked the other' using errcode = 'LS423';
  end if;
  return new;
end;
$$;

create or replace function public.block_member(p_member_id uuid) returns void
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
  perform private.lock_member_pair(actor, p_member_id);
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

-- Nothing about a request leaves by e-mail once either member blocked the other.
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
      or private.members_blocked(request.requester_id, request.recipient_id)
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
