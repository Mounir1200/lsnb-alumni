begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type public.member_role as enum ('alumni', 'student');
  end if;
  if not exists (select 1 from pg_type where typname = 'connection_request_kind') then
    create type public.connection_request_kind as enum ('contact', 'mentoring');
  end if;
  if not exists (select 1 from pg_type where typname = 'connection_request_status') then
    create type public.connection_request_status as enum ('pending', 'accepted', 'declined');
  end if;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  member_role public.member_role not null,
  graduation_year integer check (graduation_year between 2017 and 2040),
  specialty text not null default '',
  specialties text[] not null default '{}',
  domain text,
  city text,
  country text,
  experience text not null default '',
  photo_url text,
  offers_mentoring boolean not null default false,
  mentoring_topics text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_contacts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  is_visible boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  request_kind public.connection_request_kind not null,
  message text not null check (char_length(message) between 20 and 1200),
  status public.connection_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint connection_requests_distinct_members check (requester_id <> recipient_id)
);

create index if not exists profiles_domain_idx on public.profiles(domain);
create index if not exists profiles_country_idx on public.profiles(country);
create index if not exists profiles_mentoring_idx on public.profiles(offers_mentoring)
  where offers_mentoring = true;
create unique index if not exists connection_requests_pending_unique_idx
  on public.connection_requests(requester_id, recipient_id, request_kind)
  where status = 'pending';
create index if not exists connection_requests_recipient_idx
  on public.connection_requests(recipient_id, status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_profile_contacts_updated_at on public.profile_contacts;
create trigger set_profile_contacts_updated_at
before update on public.profile_contacts
for each row execute function public.set_updated_at();

create or replace function public.protect_connection_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'pending'::public.connection_request_status then
    raise exception 'Only pending requests can be answered';
  end if;

  if new.requester_id <> old.requester_id
    or new.recipient_id <> old.recipient_id
    or new.request_kind <> old.request_kind
    or new.message <> old.message then
    raise exception 'Only the request status can be changed';
  end if;

  new.responded_at = now();
  return new;
end;
$$;

drop trigger if exists protect_connection_request_update on public.connection_requests;
create trigger protect_connection_request_update
before update on public.connection_requests
for each row execute function public.protect_connection_request_update();

create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role public.member_role;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'member_role' = 'student' then 'student'::public.member_role
    else 'alumni'::public.member_role
  end;

  insert into public.profiles (
    id,
    first_name,
    last_name,
    member_role,
    graduation_year,
    specialty,
    city,
    country,
    experience,
    offers_mentoring
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'first_name', ''), 'Membre'),
    coalesce(nullif(new.raw_user_meta_data ->> 'last_name', ''), 'LSNB'),
    requested_role,
    nullif(new.raw_user_meta_data ->> 'graduation_year', '')::integer,
    coalesce(new.raw_user_meta_data ->> 'specialty', ''),
    new.raw_user_meta_data ->> 'city',
    new.raw_user_meta_data ->> 'country',
    coalesce(new.raw_user_meta_data ->> 'experience', ''),
    requested_role = 'alumni'::public.member_role
      and coalesce((new.raw_user_meta_data ->> 'offers_mentoring')::boolean, false)
  );

  insert into public.profile_contacts (profile_id, email, is_visible)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce((new.raw_user_meta_data ->> 'contact_visible')::boolean, false)
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_member();

alter table public.profiles enable row level security;
alter table public.profile_contacts enable row level security;
alter table public.connection_requests enable row level security;

drop policy if exists "Authenticated members can read active profiles" on public.profiles;
create policy "Authenticated members can read active profiles"
on public.profiles for select
to authenticated
using (is_active or id = auth.uid());

drop policy if exists "Members can insert their profile" on public.profiles;
create policy "Members can insert their profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Members can update their profile" on public.profiles;
create policy "Members can update their profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Members can read visible contacts" on public.profile_contacts;
create policy "Members can read visible contacts"
on public.profile_contacts for select
to authenticated
using (profile_id = auth.uid() or is_visible);

drop policy if exists "Members can insert their contact" on public.profile_contacts;
create policy "Members can insert their contact"
on public.profile_contacts for insert
to authenticated
with check (profile_id = auth.uid());

drop policy if exists "Members can update their contact" on public.profile_contacts;
create policy "Members can update their contact"
on public.profile_contacts for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists "Participants can read connection requests" on public.connection_requests;
create policy "Participants can read connection requests"
on public.connection_requests for select
to authenticated
using (requester_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "Members can create connection requests" on public.connection_requests;
create policy "Members can create connection requests"
on public.connection_requests for insert
to authenticated
with check (
  requester_id = auth.uid()
  and requester_id <> recipient_id
  and (
    request_kind = 'contact'::public.connection_request_kind
    or exists (
      select 1
      from public.profiles recipient
      where recipient.id = recipient_id
        and recipient.is_active
        and recipient.offers_mentoring
    )
  )
);

drop policy if exists "Recipients can answer connection requests" on public.connection_requests;
create policy "Recipients can answer connection requests"
on public.connection_requests for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

drop policy if exists "Requesters can withdraw pending requests" on public.connection_requests;
create policy "Requesters can withdraw pending requests"
on public.connection_requests for delete
to authenticated
using (requester_id = auth.uid() and status = 'pending');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are public" on storage.objects;
create policy "Avatar images are public"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "Members can upload their avatar" on storage.objects;
create policy "Members can upload their avatar"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Members can update their avatar" on storage.objects;
create policy "Members can update their avatar"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Members can delete their avatar" on storage.objects;
create policy "Members can delete their avatar"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
