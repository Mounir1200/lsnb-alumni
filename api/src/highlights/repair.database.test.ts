import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { HighlightClaim, HighlightRepairClaim } from "./types.js";

let db: PGlite;
let week: string;
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
  });
  beforeEach(async () => { await db.exec("truncate public.weekly_highlights, auth.users cascade"); });
  after(async () => { await db?.close(); });

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
      assert.equal(await save(reservation.repair_token), true);
    } finally { await db.exec("reset role"); }
  });
});
