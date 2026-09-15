begin;

-- Use only the member's explicitly declared gender for grammatical agreement.
-- This changes snapshots created by future selections only. Existing selections,
-- including later lease recovery or fallback repair, keep their immutable source.
-- Missing gender in a legacy snapshot therefore remains unknown; no backfill or
-- inference from a name, photo or current profile is performed.
comment on column public.highlight_articles.source_profile is
  'Immutable, explicitly allowlisted selection snapshot. Includes member-declared gender for grammar in new selections; legacy snapshots may omit it. Contains no contacts or authentication metadata.';

create or replace function public.claim_weekly_highlight(p_week_start date)
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
        'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'gender', p.gender,
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
-- Reaffirm the existing server-only boundary after replacing the RPC.
revoke all on function public.claim_weekly_highlight(date) from public, anon, authenticated;
grant execute on function public.claim_weekly_highlight(date) to service_role;

commit;
