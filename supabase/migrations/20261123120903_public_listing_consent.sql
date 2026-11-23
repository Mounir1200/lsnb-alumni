begin;

-- The public directory shows visitors an alumnus's name, photo, promotion,
-- specialty and town. Every new alumnus appeared there unless they found the
-- opt-out afterwards (audit of 21 November, H1). From now on nobody appears
-- without ticking "Apparaître dans l'annuaire public": at sign-up, when
-- completing a Google profile, or later in their profile editor. Members who
-- joined earlier keep the setting they have; the privacy page says so.
alter table public.profiles alter column listed_publicly set default false;

comment on column public.profiles.listed_publicly is
  'Whether an active alumnus chose to appear in the public directory shown to visitors (false until they tick it). Signed-in members see every active profile.';

-- Email sign-ups have no session until confirmation: their choice travels in
-- the sign-up metadata, like their career steps, and is applied once the
-- profile exists (trigger names sort after on_auth_user_created). Only an
-- explicit true counts, and students are never listed.
create function private.copy_signup_public_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ->> 'listed_publicly' = 'true' then
    update public.profiles set listed_publicly = true
      where id = new.id and member_role = 'alumni'::public.member_role;
  end if;
  return new;
end;
$$;
revoke all on function private.copy_signup_public_listing() from public, anon, authenticated, service_role;

create trigger on_auth_user_created_public_listing
after insert on auth.users
for each row execute function private.copy_signup_public_listing();

commit;
