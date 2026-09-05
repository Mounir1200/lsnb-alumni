begin;

-- A single optional administrative repair per article. Keep the original article,
-- immutable source snapshot and original billing marker untouched for auditability.
create table public.highlight_article_repairs (
  week_start date not null,
  slot integer not null,
  attempted_at timestamptz not null default clock_timestamp(),
  repair_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default clock_timestamp() + interval '15 minutes',
  title text,
  paragraphs jsonb,
  model text,
  generated_at timestamptz,
  primary key (week_start, slot),
  foreign key (week_start, slot) references public.highlight_articles(week_start, slot) on delete cascade,
  constraint highlight_article_repairs_completion check (
    (generated_at is null and title is null and paragraphs is null and model is null)
    or (generated_at is not null and title is not null and paragraphs is not null and model is not null)
  )
);
comment on table public.highlight_article_repairs is
  'At most one explicit AI repair attempt per published fallback. Failed or interrupted attempts stay consumed; original articles remain immutable.';

create function public.protect_highlight_repair_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.week_start is distinct from old.week_start or new.slot is distinct from old.slot
    or new.attempted_at is distinct from old.attempted_at
    or new.repair_token is distinct from old.repair_token
    or new.expires_at is distinct from old.expires_at then
    raise exception 'A Highlight repair attempt cannot be reset or reassigned';
  end if;
  if old.generated_at is not null and new is distinct from old then
    raise exception 'A saved Highlight repair is immutable';
  end if;
  return new;
end;
$$;
create trigger protect_highlight_repair_update
before update on public.highlight_article_repairs
for each row execute function public.protect_highlight_repair_update();

create function public.claim_highlight_fallback_repair(p_week_start date, p_slot integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition public.weekly_highlights%rowtype;
  v_article public.highlight_articles%rowtype;
  v_token uuid;
  v_eligible integer;
begin
  if p_week_start is distinct from date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date
    or p_slot is null or p_slot not in (1, 2) then
    raise exception 'Only current-week Highlight slots can be repaired' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(20260905, p_week_start - date '2000-01-01');
  select * into v_edition from public.weekly_highlights where week_start = p_week_start for update;
  if not found or v_edition.status <> 'published' then
    return jsonb_build_object('outcome', 'unavailable');
  end if;
  -- Lock the two current membership rows before exposing their saved snapshots.
  perform p.id from public.profiles p
    join public.highlight_articles a on a.profile_id = p.id
    where a.week_start = p_week_start and p.is_active and p.member_role = 'alumni'::public.member_role
    order by p.id for share of p;
  get diagnostics v_eligible = row_count;
  if v_eligible <> 2 then return jsonb_build_object('outcome', 'unavailable'); end if;
  select * into v_article from public.highlight_articles
    where week_start = p_week_start and slot = p_slot for update;
  if not found or v_article.generation_method <> 'fallback' or v_article.generated_at is null then
    return jsonb_build_object('outcome', 'unavailable');
  end if;
  insert into public.highlight_article_repairs (week_start, slot)
    values (p_week_start, p_slot) on conflict (week_start, slot) do nothing
    returning repair_token into v_token;
  if v_token is null then return jsonb_build_object('outcome', 'attempted'); end if;
  return jsonb_build_object('outcome', 'claimed', 'repair_token', v_token, 'article', to_jsonb(v_article));
end;
$$;

create function public.save_highlight_fallback_repair(
  p_week_start date, p_slot integer, p_repair_token uuid,
  p_title text, p_paragraphs jsonb, p_model text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition public.weekly_highlights%rowtype;
  v_eligible integer;
begin
  if p_week_start is distinct from date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date then
    return false;
  end if;
  select * into v_edition from public.weekly_highlights where week_start = p_week_start for update;
  if not found or v_edition.status <> 'published' then return false; end if;
  perform p.id from public.profiles p
    join public.highlight_articles a on a.profile_id = p.id
    where a.week_start = p_week_start and p.is_active and p.member_role = 'alumni'::public.member_role
    order by p.id for share of p;
  get diagnostics v_eligible = row_count;
  if v_eligible <> 2 then return false; end if;
  if not exists (select 1 from public.highlight_articles
    where week_start = p_week_start and slot = p_slot and generation_method = 'fallback' and generated_at is not null) then
    return false;
  end if;
  if not exists (select 1 from public.highlight_article_repairs
    where week_start = p_week_start and slot = p_slot and repair_token = p_repair_token
      and expires_at > clock_timestamp() and generated_at is null) then
    return false;
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 180
    or p_model is null or char_length(btrim(p_model)) not between 1 and 120
    or p_paragraphs is null or jsonb_typeof(p_paragraphs) <> 'array' then
    raise exception 'Invalid Highlight repair article' using errcode = '22023';
  end if;
  if jsonb_array_length(p_paragraphs) not between 1 and 4 then
    raise exception 'A Highlight repair requires one to four paragraphs' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_paragraphs) p(value)
    where jsonb_typeof(value) <> 'string' or char_length(btrim(value #>> '{}')) not between 1 and 2500) then
    raise exception 'Invalid Highlight repair paragraph' using errcode = '22023';
  end if;
  update public.highlight_article_repairs
    set title = btrim(p_title), paragraphs = p_paragraphs, model = btrim(p_model), generated_at = clock_timestamp()
    where week_start = p_week_start and slot = p_slot and repair_token = p_repair_token
      and expires_at > clock_timestamp() and generated_at is null;
  return found;
end;
$$;

alter table public.highlight_article_repairs enable row level security;
revoke all on public.highlight_article_repairs from public, anon, authenticated, service_role;
grant select on public.highlight_article_repairs to service_role;
revoke all on function public.protect_highlight_repair_update() from public, anon, authenticated;
revoke all on function public.claim_highlight_fallback_repair(date, integer) from public, anon, authenticated;
revoke all on function public.save_highlight_fallback_repair(date, integer, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_highlight_fallback_repair(date, integer) to service_role;
grant execute on function public.save_highlight_fallback_repair(date, integer, uuid, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
commit;
