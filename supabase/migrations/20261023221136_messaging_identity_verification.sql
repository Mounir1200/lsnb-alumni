begin;

-- A stolen login token cannot register an attacker's key without a fresh e-mail proof.
create table private.messaging_identity_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '10 minutes',
  attempts integer not null default 0 check(attempts between 0 and 5),
  consumed_at timestamptz
);
create index messaging_identity_challenges_user_idx on private.messaging_identity_challenges(user_id,created_at desc);
alter table private.messaging_identity_challenges enable row level security;
revoke all on private.messaging_identity_challenges from public,anon,authenticated,service_role;

create function public.messaging_begin_identity_enrollment(p_user_id uuid,p_challenge_id uuid,p_code_hash text,p_email text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare result timestamptz;
begin
  if private.maintenance_active() or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user_id and p.is_active and p.profile_completed and u.email=p_email
      and not exists(select 1 from private.hub_suspensions s where s.user_id=p.id)) then
    raise exception 'Account unavailable' using errcode='42501'; end if;
  if p_challenge_id is null or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid challenge' using errcode='22023'; end if;
  -- One shared lock also serializes the global free-tier budget.
  perform pg_advisory_xact_lock(hashtextextended('messaging:identity-enrollment',0));
  if exists(select 1 from private.messaging_identity_challenges where user_id=p_user_id and created_at>clock_timestamp()-interval '60 seconds')
    or (select count(*) from private.messaging_identity_challenges where user_id=p_user_id and created_at>clock_timestamp()-interval '1 hour')>=5
    or (select count(*) from private.messaging_identity_challenges where created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')>=60 then
    raise exception 'Please wait before requesting another code' using errcode='54000'; end if;
  update private.messaging_identity_challenges set consumed_at=clock_timestamp() where user_id=p_user_id and consumed_at is null;
  insert into private.messaging_identity_challenges(id,user_id,code_hash,email)
    values(p_challenge_id,p_user_id,p_code_hash,p_email) returning expires_at into result;
  return result;
end;
$$;

create function public.messaging_complete_identity_enrollment(p_user_id uuid,p_challenge_id uuid,p_code_hash text,
  p_public_key text,p_encrypted_private_key jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare challenge private.messaging_identity_challenges;
begin
  select * into challenge from private.messaging_identity_challenges where id=p_challenge_id and user_id=p_user_id for update;
  if not found or challenge.consumed_at is not null or challenge.expires_at<=clock_timestamp() or challenge.attempts>=5 then return false; end if;
  -- Return false instead of raising: a bad code must commit its failed-attempt counter.
  update private.messaging_identity_challenges set attempts=attempts+1 where id=challenge.id;
  if p_code_hash is null or challenge.code_hash<>p_code_hash or not exists(
    select 1 from auth.users where id=p_user_id and email=challenge.email) then return false; end if;
  perform public.messaging_register_identity(p_user_id,p_public_key,p_encrypted_private_key);
  update private.messaging_identity_challenges set consumed_at=clock_timestamp() where id=challenge.id;
  return true;
end;
$$;
revoke all on function public.messaging_begin_identity_enrollment(uuid,uuid,text,text),
  public.messaging_complete_identity_enrollment(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.messaging_begin_identity_enrollment(uuid,uuid,text,text),
  public.messaging_complete_identity_enrollment(uuid,uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
