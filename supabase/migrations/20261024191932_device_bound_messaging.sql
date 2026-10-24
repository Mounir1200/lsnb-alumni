begin;

-- Members no longer keep any personal messaging key. The database seals each message with a
-- key held in Supabase Vault, and every messaging call must be signed by a device key that
-- only a recent sign-in can obtain. This is not end-to-end encryption: whoever administers
-- the Supabase project could technically decrypt messages (see docs/messaging.md).

-- Production had no message when this replaced the end-to-end format. Refuse to run
-- otherwise instead of discarding history that nobody could decrypt again.
do $$ begin
  if exists(select 1 from public.conversation_messages) then
    raise exception 'Existing message history requires an explicit migration'; end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Retire the end-to-end format, its identities and e-mail enrollment challenges.
alter table public.conversation_messages drop constraint conversation_messages_encrypted_body_check;
alter table public.conversation_messages drop column body;
alter table public.conversation_messages add column ciphertext bytea not null, add column key_version smallint not null default 1;
drop table private.messaging_identity_challenges;
drop table private.messaging_identities;
drop function public.messaging_begin_identity_enrollment(uuid,uuid,text,text),
  public.messaging_complete_identity_enrollment(uuid,uuid,text,text,jsonb),
  public.messaging_register_identity(uuid,text,jsonb), public.messaging_get_identity(), public.messaging_get_peer_key(uuid),
  public.messaging_mark_decrypted_read(uuid,uuid[]), public.messaging_mark_read(uuid,bigint),
  public.messaging_send_message(uuid,text,uuid), public.messaging_list_conversations(uuid,integer),
  public.messaging_unread_count(), public.messaging_heartbeat(), public.messaging_email_enabled(),
  public.messaging_set_email_enabled(boolean),
  private.messaging_immutable_identity(), private.messaging_valid_envelope(text), private.messaging_valid_vault(jsonb),
  private.messaging_key_fingerprint(text), private.messaging_valid_public_key(text),
  private.messaging_decode_base64url(text,integer,integer);
drop policy "Conversation participants read their messages" on public.conversation_messages;
revoke all on public.conversation_messages from authenticated;

-- Vault keeps the key outside readable table columns and database dumps of the tables.
do $$ begin
  if to_regnamespace('vault') is not null then
    if not exists(select 1 from vault.secrets where name='messaging_message_key_v1') then
      perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'messaging_message_key_v1',
        'Chiffrement des messages privés LSNB Alumni, version 1');
    end if;
  end if;
end $$;

create function private.messaging_key(p_version smallint) returns text
language plpgsql stable security definer set search_path='' as $$
declare secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name='messaging_message_key_v'||p_version;
  if secret is null or secret !~ '^[0-9a-f]{64}$' then
    raise exception 'Messaging encryption key is unavailable' using errcode='LS503'; end if;
  return secret;
end;
$$;
-- s2k-mode=1: the Vault key is already 256 random bits, so key stretching would only cost time.
create function private.messaging_seal(p_data bytea) returns bytea
language plpgsql security definer set search_path='' as $$
begin
  return extensions.pgp_sym_encrypt_bytea(p_data,private.messaging_key(1::smallint),
    'cipher-algo=aes256, compress-algo=0, s2k-mode=1, s2k-digest-algo=sha256');
end;
$$;
create function private.messaging_unseal(p_data bytea,p_version smallint) returns bytea
language plpgsql stable security definer set search_path='' as $$
begin return extensions.pgp_sym_decrypt_bytea(p_data,private.messaging_key(p_version)); end;
$$;
-- The sealed text repeats its conversation and attempt identifiers: a ciphertext copied onto
-- another row is rejected instead of being shown in the wrong conversation.
create function private.messaging_seal_text(p_conversation_id uuid,p_client_nonce uuid,p_text text) returns bytea
language plpgsql security definer set search_path='' as $$
begin
  return private.messaging_seal(convert_to(jsonb_build_object('conversation_id',p_conversation_id,
    'client_nonce',p_client_nonce,'text',p_text)::text,'UTF8'));
end;
$$;
create function private.messaging_open(p_message public.conversation_messages) returns text
language plpgsql stable security definer set search_path='' as $$
declare payload jsonb:=convert_from(private.messaging_unseal(p_message.ciphertext,p_message.key_version),'UTF8')::jsonb;
begin
  if payload->>'conversation_id' is distinct from p_message.conversation_id::text
    or payload->>'client_nonce' is distinct from p_message.client_nonce::text then
    raise exception 'Message integrity check failed' using errcode='LS500'; end if;
  return payload->>'text';
end;
$$;
create function private.messaging_message_view(p_message public.conversation_messages) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  return jsonb_build_object('id',p_message.id,'sequence',p_message.sequence,'conversation_id',p_message.conversation_id,
    'sender_id',p_message.sender_id,'recipient_id',p_message.recipient_id,'body',private.messaging_open(p_message),
    'client_nonce',p_message.client_nonce,'created_at',p_message.created_at,'read_at',p_message.read_at);
end;
$$;
create function private.messaging_now_ms() returns bigint language sql stable set search_path='' as $$
  select floor(extract(epoch from clock_timestamp())*1000)::bigint;
$$;

-- One device key per sign-in. Deleting the auth session (sign-out, revocation) makes its
-- device useless at once, even while the access token itself has not expired yet.
create table private.messaging_devices (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sealed_key bytea not null,
  key_version smallint not null default 1,
  user_agent text,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz not null default clock_timestamp()
);
alter table private.messaging_devices enable row level security;
revoke all on private.messaging_devices from public,anon,authenticated,service_role;

create function private.messaging_session() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare current_session uuid;
begin
  begin current_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then current_session:=null; end;
  if current_session is null or not exists(select 1 from auth.sessions s where s.id=current_session
    and s.user_id=auth.uid() and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'Sign in again to use messaging on this device' using errcode='LS401'; end if;
  return current_session;
end;
$$;

-- A copied token belongs to a sign-in that already has its device key, or to one older than
-- ten minutes: neither can register a new key. The browser registers right after sign-in.
create function public.messaging_register_device() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); current_session uuid; signed_in_at timestamptz; agent text; device_key bytea;
begin
  if actor is null or private.site_allowed() is distinct from true then
    raise exception 'Messaging unavailable or account ineligible' using errcode='42501'; end if;
  current_session:=private.messaging_session();
  if exists(select 1 from private.messaging_devices d where d.session_id=current_session) then
    raise exception 'This sign-in already has a messaging device' using errcode='LS409'; end if;
  select s.created_at,s.user_agent into signed_in_at,agent from auth.sessions s where s.id=current_session;
  if signed_in_at<clock_timestamp()-interval '10 minutes' then
    raise exception 'A recent sign-in is required to add a messaging device' using errcode='LS428'; end if;
  delete from private.messaging_devices d where d.user_id=actor
    and not exists(select 1 from auth.sessions s where s.id=d.session_id);
  device_key:=extensions.gen_random_bytes(32);
  insert into private.messaging_devices(session_id,user_id,sealed_key,user_agent)
    values(current_session,actor,private.messaging_seal(device_key),left(agent,300));
  return jsonb_build_object('session_id',current_session,'key',encode(device_key,'base64'),'server_time',private.messaging_now_ms());
end;
$$;

-- Every call carries an HMAC of its action and arguments made with the device key, which the
-- browser keeps as a non-extractable key. A stolen access token alone cannot produce it.
-- Signatures stay valid five minutes to absorb network delays; the client corrects its clock.
create function private.messaging_authorize(p_action text,p_payload text,p_proof jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_messaging_member(); current_session uuid:=private.messaging_session();
  device private.messaging_devices; proof_time bigint; signature bytea;
begin
  select * into device from private.messaging_devices d where d.session_id=current_session and d.user_id=actor;
  if not found then raise exception 'This device is not authorized for messaging' using errcode='LS401'; end if;
  if jsonb_typeof(p_proof)='object' and p_proof-array['issued_at','signature']='{}'::jsonb
    and jsonb_typeof(p_proof->'issued_at')='number' and jsonb_typeof(p_proof->'signature')='string' then
    begin proof_time:=(p_proof->>'issued_at')::bigint; signature:=decode(p_proof->>'signature','base64');
    exception when others then proof_time:=null; end;
  end if;
  if proof_time is null or abs(private.messaging_now_ms()-proof_time)>300000 or signature is distinct from extensions.hmac(
    convert_to(concat_ws('|','lsnb-messaging-v1',p_action,current_session::text,proof_time::text,p_payload),'UTF8'),
    private.messaging_unseal(device.sealed_key,device.key_version),'sha256') then
    raise exception 'Invalid or expired messaging proof' using errcode='LS403'; end if;
  -- Recording activity once a minute is enough for the device list.
  if device.last_used_at<clock_timestamp()-interval '1 minute' then
    update private.messaging_devices d set last_used_at=clock_timestamp() where d.session_id=current_session; end if;
  return actor;
end;
$$;

create function private.messaging_require_participant(p_actor uuid,p_conversation_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.connection_requests r where r.id=p_conversation_id and r.status='accepted'
    and p_actor in(r.requester_id,r.recipient_id)) then
    raise exception 'An accepted conversation is required' using errcode='42501'; end if;
end;
$$;

create function public.messaging_send_message(p_conversation_id uuid,p_body text,p_client_nonce uuid,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('send',format('%s|%s|%s',p_conversation_id,p_client_nonce,p_body),p_proof);
  request public.connection_requests; peer uuid; clean_body text:=btrim(p_body); result public.conversation_messages;
begin
  if p_client_nonce is null or clean_body is null or char_length(clean_body) not between 1 and 4000 then
    raise exception 'A message must contain between 1 and 4000 characters and a nonce' using errcode='22023'; end if;
  perform private.messaging_require_participant(actor,p_conversation_id);
  select * into request from public.connection_requests where id=p_conversation_id;
  peer:=case when actor=request.requester_id then request.recipient_id else request.requester_id end;
  if not exists(select 1 from public.profiles p where p.id=peer and p.is_active and p.profile_completed
    and not exists(select 1 from private.hub_suspensions s where s.user_id=p.id)) then
    raise exception 'Recipient is unavailable' using errcode='42501'; end if;
  -- Serialize same-sender retries so a lost response never creates duplicate messages.
  perform pg_advisory_xact_lock(hashtextextended('messaging:'||actor::text,0));
  select * into result from public.conversation_messages where sender_id=actor and client_nonce=p_client_nonce;
  if found then
    if result.conversation_id<>p_conversation_id or private.messaging_open(result)<>clean_body then
      raise exception 'This nonce already belongs to a different message' using errcode='22023'; end if;
    return private.messaging_message_view(result);
  end if;
  if (select count(*) from public.conversation_messages where sender_id=actor and created_at>clock_timestamp()-interval '1 minute')>=30 then
    raise exception 'Please wait before sending more messages' using errcode='54000'; end if;
  insert into public.conversation_messages(conversation_id,sender_id,recipient_id,ciphertext,client_nonce)
    values(p_conversation_id,actor,peer,private.messaging_seal_text(p_conversation_id,p_client_nonce,clean_body),p_client_nonce)
    returning * into result;
  insert into private.messaging_members(user_id) values(peer) on conflict(user_id) do nothing;
  insert into private.messaging_email_queue(recipient_id,conversation_id) values(peer,p_conversation_id)
    on conflict(recipient_id,conversation_id) where status in('pending','processing') do nothing;
  return private.messaging_message_view(result);
end;
$$;

-- One page of history: newest first before a sequence, or oldest first after one.
create function public.messaging_get_messages(p_conversation_id uuid,p_before bigint,p_after bigint,p_limit integer,p_proof jsonb)
returns setof jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('messages',format('%s|%s|%s|%s',p_conversation_id,p_before,p_after,p_limit),p_proof);
begin
  if p_limit is null or p_limit not between 1 and 100 or (p_before is not null and p_after is not null) then
    raise exception 'Invalid message page' using errcode='22023'; end if;
  perform private.messaging_require_participant(actor,p_conversation_id);
  if p_after is not null then
    return query select private.messaging_message_view(m) from public.conversation_messages m
      where m.conversation_id=p_conversation_id and m.sequence>p_after order by m.sequence limit p_limit;
  else
    return query select private.messaging_message_view(m) from public.conversation_messages m
      where m.conversation_id=p_conversation_id and (p_before is null or m.sequence<p_before) order by m.sequence desc limit p_limit;
  end if;
end;
$$;

create function public.messaging_list_conversations(p_before uuid,p_limit integer,p_proof jsonb)
returns table(conversation_id uuid,last_message_preview text,last_message_at timestamptz,last_sequence bigint,unread_count bigint)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('list',format('%s|%s',p_before,p_limit),p_proof);
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size' using errcode='22023'; end if;
  return query select r.id,case when (latest.message).id is not null then left(private.messaging_open(latest.message),140) end,
    (latest.message).created_at,(latest.message).sequence,
    (select count(*) from public.conversation_messages u where u.conversation_id=r.id and u.recipient_id=actor and u.read_at is null)
    from public.connection_requests r
    left join lateral(select x as message from public.conversation_messages x where x.conversation_id=r.id
      order by x.sequence desc limit 1) latest on true
    where r.status='accepted' and actor in(r.requester_id,r.recipient_id) and (p_before is null or r.id<p_before)
    order by r.id desc limit p_limit;
end;
$$;

-- Only the exact messages shown to the recipient are marked read, never a whole range.
create function public.messaging_mark_read(p_conversation_id uuid,p_message_ids uuid[],p_proof jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('read',format('%s|%s',p_conversation_id,array_to_string(p_message_ids,',')),p_proof);
begin
  if p_message_ids is null or cardinality(p_message_ids) not between 1 and 200 or array_position(p_message_ids,null) is not null then
    raise exception 'Invalid message receipt list' using errcode='22023'; end if;
  perform private.messaging_require_participant(actor,p_conversation_id);
  update public.conversation_messages set read_at=clock_timestamp() where conversation_id=p_conversation_id
    and recipient_id=actor and id=any(p_message_ids) and read_at is null;
  update private.messaging_email_queue q set status='cancelled',finished_at=clock_timestamp()
    where q.recipient_id=actor and q.conversation_id=p_conversation_id and q.status='pending'
      and not exists(select 1 from public.conversation_messages m where m.recipient_id=actor
        and m.conversation_id=p_conversation_id and m.read_at is null);
end;
$$;

create function public.messaging_unread_count(p_proof jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('unread','',p_proof);
begin return (select count(*) from public.conversation_messages where recipient_id=actor and read_at is null); end;
$$;
create function public.messaging_heartbeat(p_proof jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('heartbeat','',p_proof);
begin
  insert into private.messaging_members(user_id,last_seen_at) values(actor,clock_timestamp())
    on conflict(user_id) do update set last_seen_at=excluded.last_seen_at;
end;
$$;
create function public.messaging_email_enabled(p_proof jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('email','',p_proof);
begin return coalesce((select email_enabled from private.messaging_members where user_id=actor),true); end;
$$;
create function public.messaging_set_email_enabled(p_enabled boolean,p_proof jsonb) returns void
language plpgsql security definer set search_path='' as $$
-- A cast spells the boolean "true"/"false" like the browser; its output form would be "t"/"f".
declare actor uuid:=private.messaging_authorize('email-set',format('%s',p_enabled::text),p_proof);
begin
  if p_enabled is null then raise exception 'Email preference is required' using errcode='22023'; end if;
  insert into private.messaging_members(user_id,email_enabled) values(actor,p_enabled)
    on conflict(user_id) do update set email_enabled=excluded.email_enabled;
  if not p_enabled then update private.messaging_email_queue set status='cancelled',finished_at=clock_timestamp()
    where recipient_id=actor and status='pending'; end if;
end;
$$;

create function public.messaging_list_devices(p_proof jsonb)
returns table(session_id uuid,user_agent text,created_at timestamptz,last_used_at timestamptz,is_current boolean)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('devices','',p_proof); current_session uuid:=private.messaging_session();
begin
  return query select d.session_id,d.user_agent,d.created_at,d.last_used_at,d.session_id=current_session
    from private.messaging_devices d where d.user_id=actor and exists(select 1 from auth.sessions s where s.id=d.session_id)
    order by d.session_id=current_session desc,d.last_used_at desc;
end;
$$;
-- Removing a device stops its messaging at once; it needs a new sign-in to get a key again.
create function public.messaging_revoke_device(p_session_id uuid,p_proof jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('revoke',format('%s',p_session_id),p_proof);
begin delete from private.messaging_devices d where d.user_id=actor and d.session_id=p_session_id; end;
$$;

-- Live signals carry identifiers only, never text; the browser then fetches through the signed calls.
do $$ begin
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='conversation_messages') then
    alter publication supabase_realtime drop table public.conversation_messages;
  end if;
end $$;
create function private.messaging_signal() returns trigger
language plpgsql security definer set search_path='' as $$
declare signal jsonb;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return null; end if;
  signal:=jsonb_build_object('conversation_id',new.conversation_id,'sender_id',new.sender_id,
    'recipient_id',new.recipient_id,'sequence',new.sequence,'change',lower(tg_op));
  begin
    execute 'select realtime.send($1,$2,$3,true)' using signal,'message','messaging:'||new.sender_id::text;
    execute 'select realtime.send($1,$2,$3,true)' using signal,'message','messaging:'||new.recipient_id::text;
  -- A live signal is a convenience: the periodic refresh still delivers the message.
  exception when others then null;
  end;
  return null;
end;
$$;
create trigger messaging_signal after insert or update of read_at on public.conversation_messages
  for each row execute function private.messaging_signal();
do $$ begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$create policy "Members receive their own messaging signals" on realtime.messages
      for select to authenticated
      using (extension='broadcast' and realtime.topic()='messaging:'||(select auth.uid())::text)$policy$;
  end if;
end $$;

revoke all on function private.messaging_key(smallint),private.messaging_seal(bytea),private.messaging_unseal(bytea,smallint),
  private.messaging_seal_text(uuid,uuid,text),private.messaging_open(public.conversation_messages),
  private.messaging_message_view(public.conversation_messages),private.messaging_now_ms(),private.messaging_session(),
  private.messaging_authorize(text,text,jsonb),private.messaging_require_participant(uuid,uuid),private.messaging_signal()
  from public,anon,authenticated,service_role;
revoke all on function public.messaging_register_device(),public.messaging_send_message(uuid,text,uuid,jsonb),
  public.messaging_get_messages(uuid,bigint,bigint,integer,jsonb),public.messaging_list_conversations(uuid,integer,jsonb),
  public.messaging_mark_read(uuid,uuid[],jsonb),public.messaging_unread_count(jsonb),public.messaging_heartbeat(jsonb),
  public.messaging_email_enabled(jsonb),public.messaging_set_email_enabled(boolean,jsonb),
  public.messaging_list_devices(jsonb),public.messaging_revoke_device(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.messaging_register_device(),public.messaging_send_message(uuid,text,uuid,jsonb),
  public.messaging_get_messages(uuid,bigint,bigint,integer,jsonb),public.messaging_list_conversations(uuid,integer,jsonb),
  public.messaging_mark_read(uuid,uuid[],jsonb),public.messaging_unread_count(jsonb),public.messaging_heartbeat(jsonb),
  public.messaging_email_enabled(jsonb),public.messaging_set_email_enabled(boolean,jsonb),
  public.messaging_list_devices(jsonb),public.messaging_revoke_device(uuid,jsonb)
  to authenticated;
notify pgrst,'reload schema';
commit;
