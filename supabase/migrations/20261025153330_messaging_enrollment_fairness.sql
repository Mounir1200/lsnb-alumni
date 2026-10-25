begin;

do $migration$
begin
  -- Newer deployments retired email enrollment in favor of device-bound
  -- messaging. Never recreate its removed RPC or its obsolete data model.
  if to_regclass('private.messaging_identity_challenges') is null
    and to_regclass('private.messaging_identities') is null
    and to_regprocedure('public.messaging_begin_identity_enrollment(uuid,uuid,text,text)') is null
    and to_regclass('private.messaging_devices') is not null
    and to_regclass('private.messaging_members') is not null
    and to_regprocedure('public.messaging_register_device()') is not null then
    raise notice 'Email enrollment already retired by device-bound messaging; no legacy RPC recreated';
    return;
  end if;
  if to_regclass('private.messaging_identity_challenges') is null
    or to_regclass('private.messaging_identities') is null
    or to_regprocedure('public.messaging_begin_identity_enrollment(uuid,uuid,text,text)') is null then
    raise exception 'Incompatible messaging schema; enrollment migration not applied' using errcode='55000';
  end if;
  execute $definition$
create or replace function public.messaging_begin_identity_enrollment(p_user_id uuid,p_challenge_id uuid,p_code_hash text,p_email text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare result timestamptz;
begin
  if private.maintenance_active() or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user_id and p.is_active and p.profile_completed and u.email=p_email
      and not exists(select 1 from private.hub_suspensions s where s.user_id=p.id)) then
    raise exception 'Account unavailable' using errcode='42501'; end if;
  if p_challenge_id is null or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid challenge' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('messaging:identity-enrollment',0));
  if exists(select 1 from private.messaging_identities where user_id=p_user_id) then
    raise exception 'Messaging identity already exists' using errcode='23505'; end if;
  -- A rolling window prevents doubling the allowance at midnight. Three
  -- attempts per member preserve capacity while retaining the global cost cap.
  if exists(select 1 from private.messaging_identity_challenges where user_id=p_user_id and created_at>clock_timestamp()-interval '60 seconds')
    or (select count(*) from private.messaging_identity_challenges where user_id=p_user_id and created_at>clock_timestamp()-interval '1 hour')>=5
    or (select count(*) from private.messaging_identity_challenges where user_id=p_user_id and created_at>clock_timestamp()-interval '24 hours')>=3
    or (select count(*) from private.messaging_identity_challenges where created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')>=60 then
    raise exception 'Please wait before requesting another code' using errcode='54000'; end if;
  update private.messaging_identity_challenges set consumed_at=clock_timestamp() where user_id=p_user_id and consumed_at is null;
  insert into private.messaging_identity_challenges(id,user_id,code_hash,email)
    values(p_challenge_id,p_user_id,p_code_hash,p_email) returning expires_at into result;
  return result;
end;
$$;
$definition$;
  execute 'revoke all on function public.messaging_begin_identity_enrollment(uuid,uuid,text,text) from public,anon,authenticated,service_role';
  execute 'grant execute on function public.messaging_begin_identity_enrollment(uuid,uuid,text,text) to service_role';
end;
$migration$;
notify pgrst,'reload schema';
commit;
