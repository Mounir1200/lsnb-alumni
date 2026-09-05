import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { HighlightClaim, HighlightRepairClaim } from "./types.js";

let db: PGlite;
let week: string;
let legacyBefore: Record<string, unknown>[];
let legacyAfter: Record<string, unknown>[];
const badToken = "00000000-0000-0000-0000-000000000000";
async function value<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ result: T }>(sql, params);
  assert.ok(result.rows[0]);
  return result.rows[0].result;
}
async function seed() {
  for (const gender of ["male", "female"]) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), $1, $2)", [
      `${gender}@example.test`, JSON.stringify({ first_name: "Awa", last_name: "Test", member_role: "alumni",
        graduation_year: 2020, gender, experience: "Développe des modèles statistiques." }),
    ]);
  }
}
const claim = (slot = 1, targetWeek = week) => value<HighlightRepairClaim>(
  "select public.claim_highlight_fallback_repair($1::date, $2) as result", [targetWeek, slot],
);
const retry = (slot = 1, targetWeek = week) => value<HighlightRepairClaim>(
  "select public.claim_highlight_fallback_repair($1::date, $2, true) as result", [targetWeek, slot],
);
const fail = (token: string, code = "rate_limited", status: number | null = 429,
  retryAfterSeconds: number | null = null, slot = 1, targetWeek = week) => value<boolean>(
  "select public.record_highlight_repair_failure($1::date, $2, $3::uuid, $4, $5, $6) as result",
  [targetWeek, slot, token, code, status, retryAfterSeconds],
);
const save = (token: string, slot = 1, paragraphs: unknown = ["Un portrait reformulé."], targetWeek = week) => value<boolean>(
  "select public.save_highlight_fallback_repair($1::date, $2, $3::uuid, $4, $5::jsonb, $6) as result",
  [targetWeek, slot, token, "Awa Test, les statistiques en pratique", JSON.stringify(paragraphs), "test-model"],
);
async function prepare(methods = ["fallback", "fallback"], publish = true) {
  await seed();
  const edition = await value<HighlightClaim>("select public.claim_weekly_highlight($1::date) as result", [week]);
  assert.equal(edition.outcome, "claimed");
  for (const slot of [1, 2]) {
    await value("select public.claim_ai_highlight($1::date, $2, $3::uuid) as result", [week, slot, edition.lease_token]);
    await value("select public.save_highlight_article($1::date, $2, $3::uuid, 'Original', '[\"Secours\"]'::jsonb, $4, 'test-model') as result",
      [week, slot, edition.lease_token, methods[slot - 1]]);
  }
  if (publish) await value("select public.publish_weekly_highlight($1::date, $2::uuid) as result", [week, edition.lease_token]);
  return edition;
}
const originals = () => value("select jsonb_agg(to_jsonb(a) order by slot) as result from public.highlight_articles a");
const repair = () => value<Record<string, unknown>>("select to_jsonb(r) as result from public.highlight_article_repairs r where slot = 1");
// Insert an older persisted attempt as a database-owner fixture; never alter its
// timestamps after insertion or relax the protection trigger to skip a cooldown.
async function historicalAttempt(retries = 0, failed = true, cooldown = false) {
  return value<string>(`insert into public.highlight_article_repairs (
    week_start, slot, attempted_at, expires_at, retry_count, attempt_history,
    failed_at, failure_code, failure_http_status, retry_after
  ) values (
    $1::date, 1, clock_timestamp() - interval '1 hour', clock_timestamp() - interval '45 minutes',
    $2, (select coalesce(jsonb_agg(jsonb_build_object('fixture_attempt', n)), '[]'::jsonb) from generate_series(1, $2) n),
    case when $3 then clock_timestamp() - interval '30 minutes' end,
    case when $3 then 'rate_limited' end, case when $3 then 429 end,
    case when $3 then clock_timestamp() + (case when $4 then interval '1 hour' else interval '-29 minutes' end) end
  ) returning repair_token::text as result`, [week, retries, failed, cooldown]);
}

describe("bounded administrative Highlight fallback repairs in PostgreSQL", { concurrency: false }, () => {
  before(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key, email text,
        raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1, ''/'')';
    `);
    for (const migration of ["202609040001_initial_schema", "202609050001_weekly_highlights", "202609050002_google_auth_onboarding", "202609050003_highlight_fallback_repair"]) {
      await db.exec(await readFile(new URL(`../../../supabase/migrations/${migration}.sql`, import.meta.url), "utf8"));
    }
    week = await value<string>("select date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date::text as result");
    await prepare();
    const completed = await claim();
    assert.ok(completed.repair_token);
    assert.equal(await save(completed.repair_token), true);
    await claim(2);
    legacyBefore = await value("select jsonb_agg(to_jsonb(r) order by slot) as result from public.highlight_article_repairs r");
    await db.exec(await readFile(new URL("../../../supabase/migrations/202609050004_highlight_repair_retries.sql", import.meta.url), "utf8"));
    legacyAfter = await value("select jsonb_agg(to_jsonb(r) order by slot) as result from public.highlight_article_repairs r");
  });
  beforeEach(async () => { await db.exec("truncate public.weekly_highlights, auth.users cascade"); });
  after(async () => { await db?.close(); });

  it("upgrades existing completed and interrupted repairs without clearing their tokens, results, or budget", () => {
    assert.equal(legacyBefore.length, 2);
    for (let index = 0; index < legacyBefore.length; index++) {
      const previous = legacyBefore[index];
      const upgraded = legacyAfter[index];
      assert.deepEqual(upgraded, { ...previous, retry_count: 0, attempt_history: [], failed_at: null,
        failure_code: null, failure_http_status: null, retry_after: null });
    }
  });

  it("records one extra attempt before generation, preserving original text, duo, snapshot and publication", async () => {
    await prepare();
    const initial = await originals();
    const published = await value("select published_at as result from public.weekly_highlights");
    const reservation = await claim();
    assert.equal(reservation.outcome, "claimed");
    assert.ok(reservation.repair_token);
    assert.deepEqual(reservation.article, (initial as unknown[])[0]);
    assert.equal(await value("select generated_at is null and attempted_at is not null as result from public.highlight_article_repairs"), true);
    assert.deepEqual(await originals(), initial);
    assert.equal((await claim()).outcome, "attempted");
    assert.equal(await save(reservation.repair_token), true);
    assert.equal(await save(reservation.repair_token), false);
    assert.equal((await claim()).outcome, "attempted");
    assert.deepEqual(await originals(), initial);
    assert.deepEqual(await value("select published_at as result from public.weekly_highlights"), published);
    assert.equal(await value("select title as result from public.highlight_article_repairs"), "Awa Test, les statistiques en pratique");
  });

  it("refuses AI articles, unpublished editions, missing editions and non-current slots", async () => {
    assert.equal((await claim()).outcome, "unavailable");
    await prepare(["ai", "fallback"], false);
    assert.equal((await claim(2)).outcome, "unavailable");
    await db.exec("update public.weekly_highlights set status = 'published', published_at = clock_timestamp()");
    assert.equal((await claim()).outcome, "unavailable");
    assert.equal((await claim(2)).outcome, "claimed");
    for (const slot of [0, 3]) await assert.rejects(claim(slot), /current-week/);
    const previousWeek = await value<string>("select ($1::date - 7)::text as result", [week]);
    await assert.rejects(claim(1, previousWeek), /current-week/);
    assert.equal(await save(badToken, 2, ["Un portrait."], previousWeek), false);
  });

  it("does not reacquire an interrupted or expired attempt, and rejects stale or wrong tokens", async () => {
    await prepare();
    const first = await claim();
    assert.ok(first.repair_token);
    assert.equal(await save(badToken), false);
    assert.equal(await save(first.repair_token, 2), false);
    assert.equal((await claim()).outcome, "attempted");
    // Simulate an already expired reservation at insertion, without resetting its immutable marker.
    const expiredToken = await value<string>(`insert into public.highlight_article_repairs (week_start, slot, expires_at)
      values ($1::date, 2, clock_timestamp() - interval '1 second') returning repair_token::text as result`, [week]);
    assert.equal((await claim(2)).outcome, "attempted");
    assert.equal(await save(expiredToken, 2), false);
    assert.equal(await value("select count(*)::integer as result from public.highlight_article_repairs where generated_at is not null"), 0);
  });

  it("rejects a repair when either selected profile is no longer eligible, without substituting another", async () => {
    await prepare();
    const reservation = await claim();
    assert.ok(reservation.repair_token);
    const profile = await value<string>("select profile_id::text as result from public.highlight_articles where slot = 2");
    await db.query("update public.profiles set is_active = false where id = $1::uuid", [profile]);
    assert.equal(await save(reservation.repair_token), false);
    assert.equal((await claim(2)).outcome, "unavailable");
    await db.query("update public.profiles set is_active = true, member_role = 'student' where id = $1::uuid", [profile]);
    assert.equal(await save(reservation.repair_token), false);
    await db.query("delete from auth.users where id = $1::uuid", [profile]);
    assert.equal((await claim(2)).outcome, "unavailable");
    assert.equal(await value("select count(*)::integer as result from public.highlight_articles"), 1);
  });

  it("validates repair text and protects attempts and saved repairs from reset or overwrite", async () => {
    await prepare();
    const reservation = await claim();
    assert.ok(reservation.repair_token);
    for (const paragraphs of [null, {}, [], [""], [7], ["x".repeat(2501)], ["a", "b", "c", "d", "e"]]) {
      await assert.rejects(save(reservation.repair_token, 1, paragraphs), /Highlight/);
    }
    await assert.rejects(db.exec("update public.highlight_article_repairs set attempted_at = clock_timestamp()"), /cannot be reset/);
    await assert.rejects(db.exec("update public.highlight_article_repairs set repair_token = gen_random_uuid()"), /cannot be reset/);
    await assert.rejects(db.exec("update public.highlight_article_repairs set expires_at = clock_timestamp() + interval '1 day'"), /cannot be reset/);
    assert.equal(await save(reservation.repair_token), true);
    await assert.rejects(db.exec("update public.highlight_article_repairs set title = 'Overwrite'"), /immutable/);
    await assert.rejects(db.exec("update public.highlight_articles set ai_attempted_at = null"), /cannot be reset/);
    await assert.rejects(db.exec("update public.highlight_articles set source_profile = '{}'"), /immutable/);
  });

  it("allows only server RPC claims and saves, with no member or direct server write access", async () => {
    await prepare();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(db.exec("select * from public.highlight_article_repairs"), /permission denied/);
        await assert.rejects(claim(), /permission denied/);
        await assert.rejects(retry(), /permission denied/);
        await assert.rejects(fail(badToken), /permission denied/);
        await assert.rejects(save(badToken), /permission denied/);
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try {
      const reservation = await claim();
      assert.ok(reservation.repair_token);
      assert.equal(await value("select count(*)::integer as result from public.highlight_article_repairs"), 1);
      await assert.rejects(db.exec("delete from public.highlight_article_repairs"), /permission denied/);
      await assert.rejects(db.exec("update public.highlight_article_repairs set title = 'Direct write'"), /permission denied/);
      await assert.rejects(db.exec("insert into public.highlight_article_repairs (week_start, slot) select week_start, 2 from public.weekly_highlights"), /permission denied/);
      assert.equal(await save(reservation.repair_token), true);
    } finally { await db.exec("reset role"); }
  });

  it("records failure once, rejects a late successful save, and enforces the minimum cooldown", async () => {
    await prepare();
    const reservation = await claim();
    assert.ok(reservation.repair_token);
    assert.equal(await fail(reservation.repair_token, "rate_limited", 429, 1), true);
    const failed = await repair();
    assert.equal(failed.failure_code, "rate_limited");
    assert.equal(failed.failure_http_status, 429);
    assert.equal(await value("select extract(epoch from retry_after - failed_at)::integer as result from public.highlight_article_repairs"), 60);
    assert.equal(await fail(reservation.repair_token, "provider", 503, 120), false);
    assert.deepEqual(await repair(), failed);
    assert.equal(await save(reservation.repair_token), false);
    assert.equal((await claim()).outcome, "attempted");
    const refused = await retry();
    assert.equal(refused.outcome, "cooldown");
    assert.equal((refused as { retry_after?: string }).retry_after, failed.retry_after);
    assert.deepEqual(await repair(), failed);
    await assert.rejects(db.exec("update public.highlight_article_repairs set failed_at = null, failure_code = null, failure_http_status = null, retry_after = null"), /immutable/);
  });

  it("respects a provider cooldown even after expiry and caps excessive retry delays at one day", async () => {
    await prepare();
    await historicalAttempt(0, true, true);
    assert.equal((await retry()).outcome, "cooldown");
    const second = await claim(2);
    assert.ok(second.repair_token);
    assert.equal(await fail(second.repair_token, "rate_limited", 429, 999999999, 2), true);
    assert.equal(await value("select extract(epoch from retry_after - failed_at)::integer as result from public.highlight_article_repairs where slot = 2"), 86400);
  });

  it("requires explicit opt-in and archives the exact failed attempt before rotating its token", async () => {
    await prepare();
    const originalArticles = await originals();
    const oldToken = await historicalAttempt();
    const prior = await repair();
    assert.equal((await claim()).outcome, "attempted");
    const renewed = await retry();
    assert.equal(renewed.outcome, "claimed");
    assert.ok(renewed.repair_token);
    assert.notEqual(renewed.repair_token, oldToken);
    const current = await repair();
    assert.equal(current.retry_count, 1);
    assert.equal(current.failed_at, null);
    assert.equal(current.failure_code, null);
    assert.equal(current.failure_http_status, null);
    assert.equal(current.retry_after, null);
    const archive = Object.fromEntries(["repair_token", "attempted_at", "expires_at", "retry_count", "failed_at", "failure_code", "failure_http_status", "retry_after"].map(key => [key, prior[key]]));
    assert.deepEqual(current.attempt_history, [archive]);
    assert.equal(await value("select extract(epoch from expires_at - attempted_at)::integer as result from public.highlight_article_repairs"), 900);
    assert.equal((await retry()).outcome, "attempted");
    assert.equal(await save(oldToken), false);
    assert.equal(await fail(oldToken), false);
    assert.deepEqual(await repair(), current);
    assert.equal(await save(renewed.repair_token), true);
    assert.equal((await retry()).outcome, "attempted");
    assert.deepEqual(await originals(), originalArticles);
  });

  it("allows legacy unknown failures only once their lease expires", async () => {
    await prepare();
    const active = await claim(2);
    assert.ok(active.repair_token);
    assert.equal((await retry(2)).outcome, "attempted");
    const expired = await historicalAttempt(0, false);
    assert.equal((await claim()).outcome, "attempted");
    const renewed = await retry();
    assert.equal(renewed.outcome, "claimed");
    assert.notEqual(renewed.repair_token, expired);
    assert.equal((await repair()).retry_count, 1);
    assert.equal(await save(expired), false);
    assert.equal(await fail(expired), false);
  });

  it("caps administrative retries at two across process restarts", async () => {
    await prepare();
    const token = await historicalAttempt(1);
    const prior = await repair();
    const renewed = await retry();
    assert.equal(renewed.outcome, "claimed");
    assert.notEqual(renewed.repair_token, token);
    const current = await repair();
    assert.equal(current.retry_count, 2);
    assert.deepEqual((current.attempt_history as unknown[])[0], (prior.attempt_history as unknown[])[0]);
    assert.equal((current.attempt_history as unknown[]).length, 2);
    assert.ok(renewed.repair_token);
    assert.equal(await fail(renewed.repair_token), true);
    assert.equal((await retry()).outcome, "attempted");
    assert.equal((await claim()).outcome, "attempted");
    await db.exec("truncate public.weekly_highlights, auth.users cascade");
    await prepare();
    await historicalAttempt(2);
    const exhausted = await repair();
    assert.equal((await retry()).outcome, "attempted");
    assert.deepEqual(await repair(), exhausted);
  });

  it("validates failure metadata and rejects foreign, stale, or already successful tokens", async () => {
    await prepare();
    const first = await claim();
    assert.ok(first.repair_token);
    assert.equal(await fail(badToken), false);
    assert.equal(await fail(first.repair_token, "provider", 503, null, 2), false);
    const lastWeek = await value<string>("select ($1::date - 7)::text as result", [week]);
    assert.equal(await fail(first.repair_token, "provider", 503, null, 1, lastWeek), false);
    await assert.rejects(fail(first.repair_token, "sensitive raw provider message"), /Invalid Highlight repair failure/);
    await assert.rejects(fail(first.repair_token, "provider", 600), /Invalid Highlight repair failure/);
    assert.equal(await fail(first.repair_token, "timeout", null, -999), true);
    assert.equal(await value("select extract(epoch from retry_after - failed_at)::integer as result from public.highlight_article_repairs"), 60);
    const second = await claim(2);
    assert.ok(second.repair_token);
    assert.equal(await save(second.repair_token, 2), true);
    assert.equal(await fail(second.repair_token, "provider", 503, null, 2), false);
  });

  it("protects the retry counter, exact append-only history and failed state from direct mutation", async () => {
    await prepare();
    await historicalAttempt();
    await assert.rejects(db.exec("update public.highlight_article_repairs set retry_count = 1"), /cannot be reset/);
    await assert.rejects(db.exec("update public.highlight_article_repairs set attempt_history = '[{}]'"), /immutable/);
    await assert.rejects(db.exec("update public.highlight_article_repairs set failure_code = 'provider'"), /immutable/);
    await assert.rejects(db.exec("update public.highlight_article_repairs set repair_token = gen_random_uuid(), attempted_at = clock_timestamp(), expires_at = clock_timestamp() + interval '15 minutes', retry_count = 1, attempt_history = '[{}]', failed_at = null, failure_code = null, failure_http_status = null, retry_after = null"), /cannot be reset/);
    await db.exec("set role service_role");
    try {
      const renewed = await retry();
      assert.ok(renewed.repair_token);
      assert.equal(await fail(renewed.repair_token), true);
      await assert.rejects(db.exec("update public.highlight_article_repairs set retry_count = 0"), /permission denied/);
    } finally { await db.exec("reset role"); }
    assert.equal(await value("select count(*)::integer as result from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_highlight_fallback_repair'"), 1);
  });
});
