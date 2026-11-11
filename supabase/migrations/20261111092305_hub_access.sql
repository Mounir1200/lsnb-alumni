-- The site shows team members a link to the hub on their own profile. A member
-- asks only about their own account, and the answer is the hub's own gate
-- (private.require_staff), so the link and the hub never disagree.
begin;

create function public.has_hub_access() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

revoke all on function public.has_hub_access() from public, anon, authenticated, service_role;
grant execute on function public.has_hub_access() to authenticated;

notify pgrst, 'reload schema';
commit;
