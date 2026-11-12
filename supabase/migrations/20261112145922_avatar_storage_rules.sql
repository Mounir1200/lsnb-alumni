begin;

-- A member's photo is one object, avatars/<their id>/avatar: the path the site
-- writes (src/lib/avatarPath.ts). Pages show it through its public link, which
-- Storage serves without reading these rules.
create function private.is_own_avatar(p_bucket_id text, p_name text) returns boolean
language sql stable set search_path = '' as $$
  select p_bucket_id = 'avatars' and p_name = (select auth.uid())::text || '/avatar';
$$;
revoke all on function private.is_own_avatar(text, text) from public, anon, authenticated, service_role;
grant execute on function private.is_own_avatar(text, text) to authenticated;

-- Reading the bucket was open to everyone, visitors included: anyone could list
-- every member's folder and collect the photos of pupils, of accounts waiting
-- for approval and of alumni who left the public directory. A member now reads
-- only their own photo, which replacing or removing it needs.
drop policy "Avatar images are public" on storage.objects;
create policy "Members read their own avatar" on storage.objects for select to authenticated
using (private.is_own_avatar(bucket_id, name));

-- Writing accepted any name under one's own folder, so any account, even one
-- waiting for approval, could fill the shared storage with as many 4 MB files
-- as it liked. Uploads and renames now keep to that one photo.
alter policy "Members can upload their avatar" on storage.objects
with check (private.is_own_avatar(bucket_id, name));
alter policy "Members can update their avatar" on storage.objects
using (private.is_own_avatar(bucket_id, name)) with check (private.is_own_avatar(bucket_id, name));

commit;
