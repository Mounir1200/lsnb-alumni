begin;

-- Retrying a failed administrative repair always requires an explicit opt-in.
-- The normal weekly generation and original AI billing markers stay unchanged.
alter table public.highlight_article_repairs
  add column retry_count integer not null default 0,
  add column failed_at timestamptz,
  add column failure_code text,
  add column failure_http_status integer,
  add column retry_after timestamptz,
  add column attempt_history jsonb not null default '[]'::jsonb,
  add constraint highlight_repair_retry_limit check (retry_count between 0 and 2),
  add constraint highlight_repair_failure_code check (
    failure_code in ('rate_limited', 'provider', 'timeout', 'invalid_response', 'unexpected_error')
  ),
  add constraint highlight_repair_failure_http_status check (failure_http_status between 100 and 599),
  add constraint highlight_repair_failure_state check (
    (failed_at is null and failure_code is null and failure_http_status is null and retry_after is null)
    or (failed_at is not null and failure_code is not null and retry_after is not null
      and retry_after >= failed_at + interval '60 seconds' and generated_at is null)
  ),
  add constraint highlight_repair_history_shape check (
    jsonb_typeof(attempt_history) = 'array' and jsonb_array_length(attempt_history) = retry_count
  );

comment on table public.highlight_article_repairs is
  'One initial explicit AI repair plus at most two explicitly requested retries after failure or expiry. Every claim is persisted before an AI call; prior attempts are archived and original articles remain immutable.';

create or replace function public.protect_highlight_repair_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rotation boolean;
  v_history jsonb;
begin
  if new.week_start is distinct from old.week_start or new.slot is distinct from old.slot then
    raise exception 'A Highlight repair attempt cannot be reset or reassigned';
  end if;
  if old.generated_at is not null and new is distinct from old then
    raise exception 'A saved Highlight repair is immutable';
  end if;
  v_rotation := new.repair_token is distinct from old.repair_token
    or new.attempted_at is distinct from old.attempted_at
    or new.expires_at is distinct from old.expires_at
    or new.retry_count is distinct from old.retry_count;
  if v_rotation then
    v_history := old.attempt_history || jsonb_build_array(jsonb_build_object(
      'repair_token', old.repair_token, 'attempted_at', old.attempted_at, 'expires_at', old.expires_at,
      'retry_count', old.retry_count, 'failed_at', old.failed_at, 'failure_code', old.failure_code,
      'failure_http_status', old.failure_http_status, 'retry_after', old.retry_after
    ));
    if old.generated_at is not null or old.retry_count >= 2
      or new.retry_count <> old.retry_count + 1
      or new.repair_token is not distinct from old.repair_token
      or new.attempted_at <= old.attempted_at
      or new.expires_at <> new.attempted_at + interval '15 minutes'
      or new.attempt_history is distinct from v_history
      or new.generated_at is not null or new.title is not null or new.paragraphs is not null or new.model is not null
      or new.failed_at is not null or new.failure_code is not null or new.failure_http_status is not null or new.retry_after is not null
      or (old.failed_at is null and old.expires_at > clock_timestamp())
      or (old.failed_at is not null and greatest(old.failed_at + interval '60 seconds', old.retry_after) > clock_timestamp()) then
      raise exception 'A Highlight repair attempt cannot be reset or reassigned';
    end if;
  else
    if new.attempt_history is distinct from old.attempt_history then
      raise exception 'Highlight repair attempt history is immutable';
    end if;
    if old.failed_at is not null and (
      new.failed_at is distinct from old.failed_at or new.failure_code is distinct from old.failure_code
      or new.failure_http_status is distinct from old.failure_http_status or new.retry_after is distinct from old.retry_after
      or new.generated_at is not null
    ) then
      raise exception 'A failed Highlight repair attempt is immutable';
    end if;
  end if;
  return new;
end;
$$;

-- Drop the old overload: PostgREST must resolve two arguments through the default.
drop function public.claim_highlight_fallback_repair(date, integer);
create function public.claim_highlight_fallback_repair(
  p_week_start date, p_slot integer, p_retry_failed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition public.weekly_highlights%rowtype;
  v_article public.highlight_articles%rowtype;
  v_repair public.highlight_article_repairs%rowtype;
  v_token uuid;
  v_eligible integer;
  v_attempted_at timestamptz;
  v_retry_after timestamptz;
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
  if v_token is not null then
    return jsonb_build_object('outcome', 'claimed', 'repair_token', v_token, 'article', to_jsonb(v_article));
  end if;
  if p_retry_failed is not true then return jsonb_build_object('outcome', 'attempted'); end if;
  select * into v_repair from public.highlight_article_repairs
    where week_start = p_week_start and slot = p_slot for update;
  if v_repair.generated_at is not null or v_repair.retry_count >= 2 then
    return jsonb_build_object('outcome', 'attempted');
  end if;
  if v_repair.failed_at is null then
    if v_repair.expires_at > clock_timestamp() then
      return jsonb_build_object('outcome', 'attempted');
    end if;
  else
    v_retry_after := greatest(v_repair.failed_at + interval '60 seconds', v_repair.retry_after);
    if v_retry_after > clock_timestamp() then
      return jsonb_build_object('outcome', 'cooldown', 'retry_after', v_retry_after);
    end if;
  end if;
  v_attempted_at := clock_timestamp();
  v_token := gen_random_uuid();
  update public.highlight_article_repairs
    set repair_token = v_token, attempted_at = v_attempted_at, expires_at = v_attempted_at + interval '15 minutes',
      retry_count = v_repair.retry_count + 1,
      attempt_history = v_repair.attempt_history || jsonb_build_array(jsonb_build_object(
        'repair_token', v_repair.repair_token, 'attempted_at', v_repair.attempted_at, 'expires_at', v_repair.expires_at,
        'retry_count', v_repair.retry_count, 'failed_at', v_repair.failed_at, 'failure_code', v_repair.failure_code,
        'failure_http_status', v_repair.failure_http_status, 'retry_after', v_repair.retry_after
      )),
      failed_at = null, failure_code = null, failure_http_status = null, retry_after = null
    where week_start = p_week_start and slot = p_slot;
  return jsonb_build_object('outcome', 'claimed', 'repair_token', v_token, 'article', to_jsonb(v_article));
end;
$$;

create function public.record_highlight_repair_failure(
  p_week_start date, p_slot integer, p_repair_token uuid,
  p_failure_code text, p_http_status integer, p_retry_after_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed_at timestamptz;
begin
  if p_week_start is distinct from date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date
    or p_slot is null or p_slot not in (1, 2) then
    return false;
  end if;
  if p_failure_code is null or p_failure_code not in ('rate_limited', 'provider', 'timeout', 'invalid_response', 'unexpected_error')
    or (p_http_status is not null and p_http_status not between 100 and 599) then
    raise exception 'Invalid Highlight repair failure' using errcode = '22023';
  end if;
  -- Match save/claim lock order, so a late response cannot resurrect a failed token.
  perform 1 from public.weekly_highlights where week_start = p_week_start and status = 'published' for update;
  if not found then return false; end if;
  v_failed_at := clock_timestamp();
  update public.highlight_article_repairs
    set failed_at = v_failed_at, failure_code = p_failure_code, failure_http_status = p_http_status,
      retry_after = v_failed_at + make_interval(secs => greatest(60, least(coalesce(p_retry_after_seconds, 60), 86400)))
    where week_start = p_week_start and slot = p_slot and repair_token = p_repair_token
      and generated_at is null and failed_at is null;
  return found;
end;
$$;

create or replace function public.save_highlight_fallback_repair(
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
      and expires_at > clock_timestamp() and generated_at is null and failed_at is null) then
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
      and expires_at > clock_timestamp() and generated_at is null and failed_at is null;
  return found;
end;
$$;

revoke all on public.highlight_article_repairs from public, anon, authenticated, service_role;
grant select on public.highlight_article_repairs to service_role;
revoke all on function public.protect_highlight_repair_update() from public, anon, authenticated, service_role;
revoke all on function public.claim_highlight_fallback_repair(date, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function public.record_highlight_repair_failure(date, integer, uuid, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.save_highlight_fallback_repair(date, integer, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_highlight_fallback_repair(date, integer, boolean) to service_role;
grant execute on function public.record_highlight_repair_failure(date, integer, uuid, text, integer, integer) to service_role;
grant execute on function public.save_highlight_fallback_repair(date, integer, uuid, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
commit;
