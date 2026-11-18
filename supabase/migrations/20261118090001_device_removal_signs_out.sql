begin;

-- Removing a device signs that browser out: its sign-in session ends with its key.
-- Deleting only the key let a sign-in younger than ten minutes register a new one
-- with the same access token, so the removal did not hold. Registration and every
-- signed call first check that the session still exists, which also defeats a
-- registration racing this removal. A member can only end their own sessions.
create or replace function public.messaging_revoke_device(p_session_id uuid,p_proof jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.messaging_authorize('revoke',format('%s',p_session_id),p_proof);
begin
  delete from private.messaging_devices d where d.user_id=actor and d.session_id=p_session_id;
  delete from auth.sessions s where s.user_id=actor and s.id=p_session_id;
end;
$$;

commit;
