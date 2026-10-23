begin;

-- The server holds only public identity keys and a private-key vault encrypted
-- by a uniformly random 256-bit recovery secret that never reaches the server.
create function private.messaging_decode_base64url(p_value text,p_min integer,p_max integer)
returns bytea language plpgsql immutable set search_path = '' as $$
declare decoded bytea;
begin
  if p_value is null or p_value !~ '^[A-Za-z0-9_-]+$' or length(p_value)>ceil(p_max*4.0/3) then
    raise exception 'Invalid encrypted encoding' using errcode='22023'; end if;
  begin decoded:=decode(translate(p_value,'-_','+/')||repeat('=',(4-length(p_value)%4)%4),'base64');
  exception when others then raise exception 'Invalid encrypted encoding' using errcode='22023'; end;
  if octet_length(decoded) not between p_min and p_max
    or rtrim(translate(replace(encode(decoded,'base64'),E'\n',''),'+/','-_'),'=')<>p_value then
    raise exception 'Invalid encrypted encoding' using errcode='22023'; end if;
  return decoded;
end;
$$;
create function private.messaging_valid_public_key(p_key text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin return get_byte(private.messaging_decode_base64url(p_key,65,65),0)=4; end;
$$;
create function private.messaging_key_fingerprint(p_key text) returns text
language sql immutable set search_path = '' as $$
  select rtrim(translate(encode(sha256(private.messaging_decode_base64url(p_key,65,65)),'base64'),'+/','-_'),'=');
$$;
create function private.messaging_valid_vault(p_vault jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if p_vault is null or jsonb_typeof(p_vault)<>'object'
    or not p_vault ?& array['v','alg','iv','ct'] or p_vault-array['v','alg','iv','ct']<>'{}'::jsonb
    or p_vault->'v' is distinct from '1'::jsonb or p_vault->>'alg' is distinct from 'A256GCM'
    or jsonb_typeof(p_vault->'iv')<>'string' or jsonb_typeof(p_vault->'ct')<>'string' then return false; end if;
  perform private.messaging_decode_base64url(p_vault->>'iv',12,12);
  perform private.messaging_decode_base64url(p_vault->>'ct',17,2048);
  return true;
end;
$$;
create table private.messaging_identities (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  public_key text not null check(private.messaging_valid_public_key(public_key)),
  encrypted_private_key jsonb not null check(private.messaging_valid_vault(encrypted_private_key)),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.messaging_identities enable row level security;
revoke all on private.messaging_identities from public,anon,authenticated,service_role;

create function private.messaging_immutable_identity() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Messaging identities are immutable; no session-based reset is permitted' using errcode='42501'; end;
$$;
create trigger messaging_immutable_identity before update on private.messaging_identities
for each row execute function private.messaging_immutable_identity();

-- Only a server endpoint that verifies a fresh email OTP may enroll an identity.
-- A bearer session alone cannot register a substitute key, reset or overwrite it.
create function public.messaging_register_identity(p_user_id uuid,p_public_key text,p_encrypted_private_key jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare existing private.messaging_identities;
begin
  if private.maintenance_active() or not exists(select 1 from public.profiles p where p.id=p_user_id
    and p.is_active and p.profile_completed and not exists(select 1 from private.hub_suspensions s where s.user_id=p.id)) then
    raise exception 'Messaging unavailable or account ineligible' using errcode='42501'; end if;
  if private.messaging_valid_public_key(p_public_key) is distinct from true
    or private.messaging_valid_vault(p_encrypted_private_key) is distinct from true then
    raise exception 'Invalid encrypted identity' using errcode='22023'; end if;
  insert into private.messaging_identities(user_id,public_key,encrypted_private_key)
    values(p_user_id,p_public_key,p_encrypted_private_key) on conflict(user_id) do nothing;
  select * into existing from private.messaging_identities where user_id=p_user_id;
  if existing.public_key<>p_public_key or existing.encrypted_private_key<>p_encrypted_private_key then
    raise exception 'Messaging identity already exists and cannot be replaced' using errcode='42501'; end if;
end;
$$;
create function public.messaging_get_identity() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=private.require_messaging_member();
begin
  return (select jsonb_build_object('user_id',user_id,'public_key',public_key,'encrypted_private_key',encrypted_private_key)
    from private.messaging_identities where user_id=actor);
end;
$$;
create function public.messaging_get_peer_key(p_conversation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=private.require_messaging_member(); peer uuid;
begin
  select case when requester_id=actor then recipient_id else requester_id end into peer
    from public.connection_requests where id=p_conversation_id and status='accepted' and actor in(requester_id,recipient_id);
  if not found then raise exception 'An accepted conversation is required' using errcode='42501'; end if;
  return (select jsonb_build_object('user_id',user_id,'public_key',public_key) from private.messaging_identities where user_id=peer);
end;
$$;

create function private.messaging_valid_envelope(p_body text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb;
begin
  if p_body is null or length(p_body)>24000 then return false; end if;
  begin e:=p_body::jsonb;
  exception when others then return false; end;
  if jsonb_typeof(e)<>'object' or not e ?& array['v','alg','salt','iv','ct','sender_key','recipient_key']
    or e-array['v','alg','salt','iv','ct','sender_key','recipient_key']<>'{}'::jsonb
    or e->'v' is distinct from '1'::jsonb or e->>'alg' is distinct from 'P256-HKDF-SHA256-A256GCM'
    or jsonb_typeof(e->'salt')<>'string' or jsonb_typeof(e->'iv')<>'string' or jsonb_typeof(e->'ct')<>'string'
    or jsonb_typeof(e->'sender_key')<>'string' or jsonb_typeof(e->'recipient_key')<>'string' then return false; end if;
  perform private.messaging_decode_base64url(e->>'salt',32,32);
  perform private.messaging_decode_base64url(e->>'iv',12,12);
  perform private.messaging_decode_base64url(e->>'ct',17,16016);
  perform private.messaging_decode_base64url(e->>'sender_key',32,32);
  perform private.messaging_decode_base64url(e->>'recipient_key',32,32);
  return true;
end;
$$;
-- Fail closed if an installation contains unexpected cleartext history. Review
-- and migrate it explicitly; never silently erase or relabel existing data.
do $$ begin
  if exists(select 1 from public.conversation_messages where private.messaging_valid_envelope(body) is distinct from true) then
    raise exception 'Existing cleartext conversation history requires an explicit migration'; end if;
end $$;
alter table public.conversation_messages drop constraint conversation_messages_body_check;
alter table public.conversation_messages add constraint conversation_messages_encrypted_body_check check(private.messaging_valid_envelope(body));

create or replace function public.messaging_send_message(p_conversation_id uuid,p_body text,p_client_nonce uuid)
returns public.conversation_messages language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_messaging_member(); request public.connection_requests;
  result public.conversation_messages; peer uuid; actor_key text; peer_key text; envelope jsonb;
begin
  if p_client_nonce is null or private.messaging_valid_envelope(p_body) is distinct from true then
    raise exception 'Only valid encrypted message envelopes are accepted' using errcode='22023'; end if;
  select * into request from public.connection_requests where id=p_conversation_id;
  if not found or request.status<>'accepted' or actor not in(request.requester_id,request.recipient_id) then
    raise exception 'An accepted conversation is required' using errcode='42501'; end if;
  peer:=case when actor=request.requester_id then request.recipient_id else request.requester_id end;
  if not exists(select 1 from public.profiles p where p.id=peer and p.is_active and p.profile_completed
    and not exists(select 1 from private.hub_suspensions s where s.user_id=p.id)) then
    raise exception 'Recipient is unavailable' using errcode='42501'; end if;
  select public_key into actor_key from private.messaging_identities where user_id=actor;
  select public_key into peer_key from private.messaging_identities where user_id=peer;
  if actor_key is null or peer_key is null then
    raise exception 'Both participants must activate encrypted messaging' using errcode='42501'; end if;
  envelope:=p_body::jsonb;
  if envelope->>'sender_key'<>private.messaging_key_fingerprint(actor_key)
    or envelope->>'recipient_key'<>private.messaging_key_fingerprint(peer_key) then
    raise exception 'Message identity keys do not match its participants' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('messaging:'||actor::text,0));
  select * into result from public.conversation_messages where sender_id=actor and client_nonce=p_client_nonce;
  if found then
    if result.conversation_id<>p_conversation_id or result.body<>p_body then
      raise exception 'This nonce already belongs to a different message' using errcode='22023'; end if;
    return result;
  end if;
  if (select count(*) from public.conversation_messages where sender_id=actor and created_at>clock_timestamp()-interval '1 minute')>=30 then
    raise exception 'Please wait before sending more messages' using errcode='54000'; end if;
  insert into public.conversation_messages(conversation_id,sender_id,recipient_id,body,client_nonce)
    values(p_conversation_id,actor,peer,p_body,p_client_nonce) returning * into result;
  insert into private.messaging_members(user_id) values(peer) on conflict(user_id) do nothing;
  insert into private.messaging_email_queue(recipient_id,conversation_id) values(peer,p_conversation_id)
    on conflict(recipient_id,conversation_id) where status in('pending','processing') do nothing;
  return result;
end;
$$;
create or replace function public.messaging_list_conversations(p_before uuid default null,p_limit integer default 100)
returns table(conversation_id uuid,last_message_body text,last_message_at timestamptz,last_sequence bigint,unread_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=private.require_messaging_member();
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size' using errcode='22023'; end if;
  return query select r.id,case when m.sequence is not null then 'Message chiffré'::text else null::text end,m.created_at,m.sequence,
    (select count(*) from public.conversation_messages u where u.conversation_id=r.id and u.recipient_id=actor and u.read_at is null)
    from public.connection_requests r left join lateral(select x.created_at,x.sequence from public.conversation_messages x
      where x.conversation_id=r.id order by x.sequence desc limit 1) m on true
    where r.status='accepted' and actor in(r.requester_id,r.recipient_id) and(p_before is null or r.id<p_before)
    order by r.id desc limit p_limit;
end;
$$;
create function public.messaging_mark_decrypted_read(p_conversation_id uuid,p_message_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_messaging_member();
begin
  if p_message_ids is null or cardinality(p_message_ids) not between 1 and 200 or array_position(p_message_ids,null) is not null then
    raise exception 'Invalid message receipt list' using errcode='22023'; end if;
  if not exists(select 1 from public.connection_requests where id=p_conversation_id and status='accepted' and actor in(requester_id,recipient_id)) then
    raise exception 'An accepted conversation is required' using errcode='42501'; end if;
  update public.conversation_messages set read_at=clock_timestamp() where conversation_id=p_conversation_id
    and recipient_id=actor and id=any(p_message_ids) and read_at is null;
  update private.messaging_email_queue q set status='cancelled',finished_at=clock_timestamp()
    where q.recipient_id=actor and q.conversation_id=p_conversation_id and q.status='pending'
      and not exists(select 1 from public.conversation_messages m where m.recipient_id=actor and m.conversation_id=p_conversation_id and m.read_at is null);
end;
$$;

revoke all on function private.messaging_decode_base64url(text,integer,integer),private.messaging_valid_public_key(text),
  private.messaging_key_fingerprint(text),private.messaging_valid_vault(jsonb),private.messaging_immutable_identity(),
  private.messaging_valid_envelope(text) from public,anon,authenticated,service_role;
revoke all on function public.messaging_register_identity(uuid,text,jsonb),public.messaging_get_identity(),public.messaging_get_peer_key(uuid),
  public.messaging_mark_decrypted_read(uuid,uuid[]),public.messaging_mark_read(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.messaging_register_identity(uuid,text,jsonb) to service_role;
grant execute on function public.messaging_get_identity(),public.messaging_get_peer_key(uuid),public.messaging_mark_decrypted_read(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
