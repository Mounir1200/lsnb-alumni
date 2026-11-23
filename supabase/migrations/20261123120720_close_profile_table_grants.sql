begin;

-- Supabase opens every table postgres creates in public to the API roles, with
-- every privilege (pg_default_acl), until a migration revokes them. Each table
-- added since the first migration does so; profiles and profile_contacts never
-- did, so visitors and members still held TRUNCATE, TRIGGER, REFERENCES and
-- MAINTAIN on them, which row-level security does not cover (audit of
-- 21 November, F5). Nothing reaches them that way today; no grant should let it.
--
-- Visitors see profiles only through public functions (the public directory),
-- so they keep no right on either table. Members keep what the site uses:
-- reading, and writing their own rows under row-level security. No policy lets
-- them delete a row: erasing an account goes through delete_my_account().
revoke all on table public.profiles, public.profile_contacts from anon;
revoke delete, truncate, references, trigger, maintain on table public.profiles, public.profile_contacts from authenticated;

-- Trigger functions run when the database fires them, never through the API.
revoke execute on function public.handle_new_member(), public.set_updated_at() from public, anon, authenticated;

commit;
