begin;

-- Every member can erase their own account. The existing cascades take the
-- profile and everything tied to it: contact, relations, requests, messages
-- and devices, offers, blocks, staff role, activity and Highlight portraits.
-- Reports the member filed stay, without their name. The site removes the
-- photo through the Storage API first, while the session can still reach it.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to delete your account' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon, authenticated, service_role;
grant execute on function public.delete_my_account() to authenticated;

notify pgrst, 'reload schema';

commit;
