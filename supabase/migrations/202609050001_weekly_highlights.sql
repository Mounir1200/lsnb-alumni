begin;

-- Gender is explicitly supplied by the member. Existing profiles remain unknown.
alter table public.profiles add column gender text;
alter table public.profiles add constraint profiles_gender_check
  check (gender in ('male', 'female', 'unspecified'));

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
    id, first_name, last_name, member_role, graduation_year, specialty,
    city, country, experience, offers_mentoring, gender
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
      and coalesce((new.raw_user_meta_data ->> 'offers_mentoring')::boolean, false),
    case when new.raw_user_meta_data ->> 'gender' in ('male', 'female', 'unspecified')
      then new.raw_user_meta_data ->> 'gender' else null end
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

create table public.weekly_highlights (
  week_start date primary key check (extract(isodow from week_start) = 1),
  status text not null default 'generating' check (status in ('generating', 'published', 'empty')),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint weekly_highlights_lease_pair check ((lease_token is null) = (lease_expires_at is null)),
  constraint weekly_highlights_publication check ((status = 'published') = (published_at is not null))
);

create table public.highlight_articles (
  week_start date not null references public.weekly_highlights(week_start) on delete cascade,
  slot integer not null check (slot in (1, 2)),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_profile jsonb not null check (jsonb_typeof(source_profile) = 'object'),
  title text,
  paragraphs jsonb,
  generation_method text check (generation_method in ('ai', 'fallback')),
  ai_attempted_at timestamptz,
  model text,
  generated_at timestamptz,
  primary key (week_start, slot),
  unique (week_start, profile_id),
  constraint highlight_articles_completion check (
    (generated_at is null and title is null and paragraphs is null and generation_method is null)
    or
    (generated_at is not null and title is not null and paragraphs is not null and generation_method is not null)
  )
);
create index highlight_articles_profile_idx on public.highlight_articles(profile_id, week_start);

comment on table public.weekly_highlights is
  'One durable edition per Monday in Africa/Ouagadougou (UTC). Database persistence replaces an external cache.';
comment on column public.highlight_articles.ai_attempted_at is
  'Set before the external request. Never reset: a crashed or timed-out request is recovered with a factual fallback, without another AI charge.';
comment on column public.highlight_articles.source_profile is
  'Immutable, explicitly allowlisted selection snapshot. Contains no contacts, gender or authentication metadata.';

create function public.protect_highlight_article_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.week_start is distinct from old.week_start
    or new.slot is distinct from old.slot
    or new.profile_id is distinct from old.profile_id
    or new.source_profile is distinct from old.source_profile then
    raise exception 'The selected Highlight profile and its source are immutable';
  end if;
  if old.ai_attempted_at is not null and new.ai_attempted_at is distinct from old.ai_attempted_at then
    raise exception 'A Highlight AI attempt cannot be reset';
  end if;
  if old.generated_at is not null and (
    new.title is distinct from old.title
    or new.paragraphs is distinct from old.paragraphs
    or new.generation_method is distinct from old.generation_method
    or new.model is distinct from old.model
    or new.generated_at is distinct from old.generated_at
  ) then
    raise exception 'A saved Highlight article is immutable';
  end if;
  return new;
end;
$$;
create trigger protect_highlight_article_update
before update on public.highlight_articles
for each row execute function public.protect_highlight_article_update();

create function public.claim_weekly_highlight(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition public.weekly_highlights%rowtype;
  v_selected_ids uuid[];
  v_locked_profiles integer;
  v_lease_token uuid;
  v_articles jsonb;
begin
  if p_week_start is distinct from date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date then
    raise exception 'Highlights can only be generated for the current Monday in Africa/Ouagadougou'
      using errcode = '22023';
  end if;

  -- All contenders for the same edition serialize before either selection or recovery.
  perform pg_advisory_xact_lock(20260905, p_week_start - date '2000-01-01');
  select * into v_edition from public.weekly_highlights
    where week_start = p_week_start for update;

  if found then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.slot), '[]'::jsonb)
      into v_articles from public.highlight_articles a where a.week_start = p_week_start;
    if v_edition.status = 'published' then
      return jsonb_build_object('outcome', 'published', 'articles', v_articles);
    end if;
    -- If a selected account was deleted, never substitute a third profile or charge again.
    if v_edition.status = 'empty' or jsonb_array_length(v_articles) <> 2 then
      update public.weekly_highlights set status = 'empty', lease_token = null, lease_expires_at = null
        where week_start = p_week_start;
      return jsonb_build_object('outcome', 'empty', 'articles', '[]'::jsonb);
    end if;
    if v_edition.lease_expires_at > clock_timestamp() then
      return jsonb_build_object('outcome', 'busy', 'articles', '[]'::jsonb);
    end if;
  else
    -- Fair rotation: choose among the lowest previous published appearance counts,
    -- with a random male/female duo whenever both are available at that tier.
    -- Unknown genders remain eligible and are never inferred from names or images.
    with candidates as materialized (
      select p.id, p.gender, count(h.profile_id) as appearances
      from public.profiles p
      left join (
        select a.profile_id
        from public.highlight_articles a
        join public.weekly_highlights w on w.week_start = a.week_start and w.status = 'published'
        where a.week_start < p_week_start
      ) h on h.profile_id = p.id
      where p.is_active and p.member_role = 'alumni'::public.member_role
      group by p.id, p.gender
    ), least_used as (
      select * from candidates where appearances = (select min(appearances) from candidates)
    ), first_pick as (
      select c.id, c.gender from least_used c
      order by case when c.gender in ('male', 'female')
        and exists (select 1 from least_used where gender = 'male')
        and exists (select 1 from least_used where gender = 'female')
        then 0 else 1 end, random()
      limit 1
    ), second_pick as (
      select c.id from candidates c cross join first_pick f
      where c.id <> f.id
      order by c.appearances,
        case when (f.gender = 'male' and c.gender = 'female')
          or (f.gender = 'female' and c.gender = 'male') then 0 else 1 end,
        random()
      limit 1
    )
    select array(select id from first_pick union all select id from second_pick) into v_selected_ids;

    if cardinality(v_selected_ids) < 2 then
      -- No row is persisted, allowing another attempt if a second alumnus joins later.
      return jsonb_build_object('outcome', 'empty', 'articles', '[]'::jsonb);
    end if;

    -- Keep both selected rows eligible and present until their snapshots commit.
    -- A concurrent deletion/deactivation before this lock can be retried safely.
    perform 1 from public.profiles
      where id = any(v_selected_ids) and is_active and member_role = 'alumni'::public.member_role
      order by id for share;
    get diagnostics v_locked_profiles = row_count;
    if v_locked_profiles <> 2 then
      return jsonb_build_object('outcome', 'empty', 'articles', '[]'::jsonb);
    end if;

    insert into public.weekly_highlights (week_start) values (p_week_start);
    insert into public.highlight_articles (week_start, slot, profile_id, source_profile)
    select p_week_start, chosen.slot::integer, p.id,
      jsonb_build_object(
        'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
        'graduation_year', p.graduation_year, 'specialty', p.specialty,
        'specialties', p.specialties, 'domain', p.domain, 'city', p.city,
        'country', p.country, 'experience', p.experience, 'photo_url', p.photo_url,
        'offers_mentoring', p.offers_mentoring, 'mentoring_topics', p.mentoring_topics
      )
    from unnest(v_selected_ids) with ordinality chosen(id, slot)
    join public.profiles p on p.id = chosen.id;
  end if;

  v_lease_token := gen_random_uuid();
  update public.weekly_highlights
    set lease_token = v_lease_token, lease_expires_at = clock_timestamp() + interval '15 minutes'
    where week_start = p_week_start;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.slot), '[]'::jsonb)
    into v_articles from public.highlight_articles a where a.week_start = p_week_start;
  return jsonb_build_object('outcome', 'claimed', 'lease_token', v_lease_token, 'articles', v_articles);
end;
$$;

create function public.claim_ai_highlight(p_week_start date, p_slot integer, p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition public.weekly_highlights%rowtype;
begin
  select * into v_edition from public.weekly_highlights where week_start = p_week_start for update;
  if not found or v_edition.status <> 'generating'
    or v_edition.lease_token is distinct from p_lease_token
    or v_edition.lease_expires_at is null or v_edition.lease_expires_at <= clock_timestamp() then
    return false;
  end if;
  update public.highlight_articles set ai_attempted_at = clock_timestamp()
    where week_start = p_week_start and slot = p_slot
      and ai_attempted_at is null and generated_at is null;
  return found;
end;
$$;

create function public.save_highlight_article(
  p_week_start date, p_slot integer, p_lease_token uuid,
  p_title text, p_paragraphs jsonb, p_generation_method text, p_model text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition public.weekly_highlights%rowtype;
begin
  select * into v_edition from public.weekly_highlights where week_start = p_week_start for update;
  if not found or v_edition.status <> 'generating'
    or v_edition.lease_token is distinct from p_lease_token
    or v_edition.lease_expires_at is null or v_edition.lease_expires_at <= clock_timestamp() then
    return false;
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 180
    or p_generation_method is null or p_generation_method not in ('ai', 'fallback')
    or p_paragraphs is null or jsonb_typeof(p_paragraphs) <> 'array' then
    raise exception 'Invalid Highlight article' using errcode = '22023';
  end if;
  if jsonb_array_length(p_paragraphs) not between 1 and 4 then
    raise exception 'A Highlight article requires one to four paragraphs' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_paragraphs) p(value)
    where jsonb_typeof(value) <> 'string' or char_length(btrim(value #>> '{}')) not between 1 and 2500) then
    raise exception 'Invalid Highlight paragraph' using errcode = '22023';
  end if;
  update public.highlight_articles
    set title = btrim(p_title), paragraphs = p_paragraphs,
      generation_method = p_generation_method,
      model = case when p_generation_method = 'ai' then p_model else null end,
      generated_at = clock_timestamp()
    where week_start = p_week_start and slot = p_slot and generated_at is null
      and (p_generation_method = 'fallback' or ai_attempted_at is not null);
  return found;
end;
$$;

create function public.publish_weekly_highlight(p_week_start date, p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition public.weekly_highlights%rowtype;
begin
  select * into v_edition from public.weekly_highlights where week_start = p_week_start for update;
  if not found or v_edition.status <> 'generating'
    or v_edition.lease_token is distinct from p_lease_token
    or v_edition.lease_expires_at is null or v_edition.lease_expires_at <= clock_timestamp() then
    return false;
  end if;
  if (select count(*) from public.highlight_articles
      where week_start = p_week_start and generated_at is not null) <> 2 then
    return false;
  end if;
  update public.weekly_highlights set status = 'published', published_at = clock_timestamp(),
    lease_token = null, lease_expires_at = null where week_start = p_week_start;
  return true;
end;
$$;

-- Public HTTP responses are curated by the API. Browsers cannot inspect snapshots,
-- attempt markers, leases or gender through the Highlight tables or RPCs.
alter table public.weekly_highlights enable row level security;
alter table public.highlight_articles enable row level security;
revoke all on public.weekly_highlights, public.highlight_articles from public, anon, authenticated, service_role;
grant select on public.weekly_highlights, public.highlight_articles to service_role;

revoke all on function public.protect_highlight_article_update() from public, anon, authenticated;
revoke all on function public.claim_weekly_highlight(date) from public, anon, authenticated;
revoke all on function public.claim_ai_highlight(date, integer, uuid) from public, anon, authenticated;
revoke all on function public.save_highlight_article(date, integer, uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.publish_weekly_highlight(date, uuid) from public, anon, authenticated;
grant execute on function public.claim_weekly_highlight(date) to service_role;
grant execute on function public.claim_ai_highlight(date, integer, uuid) to service_role;
grant execute on function public.save_highlight_article(date, integer, uuid, text, jsonb, text, text) to service_role;
grant execute on function public.publish_weekly_highlight(date, uuid) to service_role;

commit;
