import assert from "node:assert/strict";
import test from "node:test";
import { repairWeeklyHighlight } from "./repair.js";
import { HighlightGenerationError } from "./generator.js";
import { createHighlightStore } from "./store.js";
import type { GeneratedArticle, HighlightRepairFailure, HighlightRepairStore, SourceProfile, StoredArticle } from "./types.js";

const now = new Date("2026-09-05T12:00:00Z");
const source: SourceProfile = {
  id: "member-1", first_name: "Awa", last_name: "Sanou", graduation_year: 2020,
  specialty: "Mathématiques", specialties: [], domain: null, city: "Bobo-Dioulasso",
  country: "Burkina Faso", experience: "Travaille sur des modèles statistiques.",
  photo_url: null, offers_mentoring: false, mentoring_topics: [],
};
const generated: GeneratedArticle = {
  title: "Awa Sanou, les mathématiques en pratique", paragraphs: ["Un portrait reformulé."],
  generationMethod: "ai", model: "test-model",
};

function fixture() {
  const articles: StoredArticle[] = [1, 2].map(slot => ({
    slot, profile_id: `member-${slot}`, source_profile: { ...source, id: `member-${slot}` },
    title: "Original", paragraphs: ["Ancien texte de secours."], generation_method: "fallback",
    ai_attempted_at: "2026-08-31T00:00:00Z", generated_at: "2026-08-31T00:00:30Z",
  }));
  const attempts = new Set<number>();
  const repairs = new Map<number, GeneratedArticle>();
  const recordedFailures = new Map<number, HighlightRepairFailure>();
  const store: HighlightRepairStore = {
    current: async () => null, claim: async () => ({ outcome: "published" }),
    claimAi: async () => { throw new Error("Normal generation must not run."); },
    save: async () => { throw new Error("Original articles must not change."); },
    publish: async () => { throw new Error("Publication must not change."); },
    claimRepair: async (week, slot) => {
      assert.equal(week, "2026-08-31");
      const article = articles[slot - 1]!;
      if (article.generation_method !== "fallback") return { outcome: "unavailable" };
      if (attempts.has(slot)) return { outcome: "attempted" };
      attempts.add(slot);
      return { outcome: "claimed", repair_token: `token-${slot}`, article: structuredClone(article) };
    },
    recordRepairFailure: async (_, slot, token, failure) => {
      assert.equal(token, `token-${slot}`);
      recordedFailures.set(slot, failure);
      return true;
    },
    saveRepair: async (_, slot, token, article) => {
      assert.equal(token, `token-${slot}`);
      repairs.set(slot, article);
      return true;
    },
  };
  return { store, articles, attempts, repairs, recordedFailures };
}

test("two overlapping explicit repairs and later reruns spend at most one extra attempt per fallback", async () => {
  const { store, articles, attempts, repairs } = fixture();
  const original = structuredClone(articles);
  let calls = 0;
  const generate = async (profile: SourceProfile) => {
    assert.ok(attempts.has(Number(profile.id.at(-1))));
    calls++;
    return generated;
  };
  const results = await Promise.all([
    repairWeeklyHighlight({ store, generate, now }), repairWeeklyHighlight({ store, generate, now }),
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.repaired, 0), 2);
  assert.equal(calls, 2);
  assert.equal(repairs.size, 2);
  assert.deepEqual(articles, original);
  assert.deepEqual(await repairWeeklyHighlight({ store, generate, now }), {
    outcome: "unchanged", attempted: 0, repaired: 0, failures: 0,
  });
  assert.equal(calls, 2);
});

test("only fallback slots are repaired and their saved snapshots are reused", async () => {
  const { store, articles, repairs } = fixture();
  articles[0]!.generation_method = "ai";
  const result = await repairWeeklyHighlight({ store, now, generate: async profile => {
    assert.deepEqual(profile, articles[1]!.source_profile);
    return generated;
  } });
  assert.deepEqual(result, { outcome: "repaired", attempted: 1, repaired: 1, failures: 0 });
  assert.deepEqual([...repairs.keys()], [2]);
});

test("failed, fallback and lost-save results retain the original article and consume their repair attempts", async () => {
  for (const failure of ["provider", "fallback", "save"] as const) {
    const { store, articles, repairs } = fixture();
    const original = structuredClone(articles);
    const errors: number[] = [];
    if (failure === "save") store.saveRepair = async () => false;
    const generate = async () => {
      if (failure === "provider") throw new Error("Upstream failed");
      return { ...generated, generationMethod: failure === "fallback" ? "fallback" as const : "ai" as const };
    };
    const result = await repairWeeklyHighlight({ store, generate, now, onFailure: slot => errors.push(slot) });
    assert.deepEqual(result, { outcome: "unchanged", attempted: 2, repaired: 0, failures: 2 });
    assert.deepEqual(errors, [1, 2]);
    assert.equal(repairs.size, 0);
    assert.deepEqual(articles, original);
    assert.equal((await repairWeeklyHighlight({ store, generate, now })).attempted, 0);
  }
});

test("a consumed repair from a crashed job is not retried, while an untouched slot remains repairable", async () => {
  const { store, attempts, repairs } = fixture();
  attempts.add(1);
  const result = await repairWeeklyHighlight({ store, now, generate: async () => generated });
  assert.equal(result.attempted, 1);
  assert.deepEqual([...repairs.keys()], [2]);
});

test("invalid or unavailable reservations never issue an AI request", async () => {
  const { store } = fixture();
  let calls = 0;
  const generate = async () => { calls++; return generated; };
  store.claimRepair = async () => ({ outcome: "unavailable" });
  assert.equal((await repairWeeklyHighlight({ store, generate, now })).attempted, 0);
  store.claimRepair = async () => ({ outcome: "claimed" });
  await assert.rejects(repairWeeklyHighlight({ store, generate, now }), /reservation/);
  assert.equal(calls, 0);
});

test("public reads overlay completed repairs and preserve fallbacks during an incomplete repair", async () => {
  const rows = [1, 2].map(slot => ({
    slot, profile_id: `member-${slot}`, source_profile: source,
    title: "Original", paragraphs: ["Texte de secours."], generation_method: "fallback",
    profiles: { is_active: true, member_role: "alumni" },
    highlight_article_repairs: slot === 1
      ? { title: generated.title, paragraphs: generated.paragraphs, generated_at: "2026-09-05T12:00:00Z", repair_token: "private-token" }
      : { title: null, paragraphs: null, generated_at: null, repair_token: "private-token" },
  }));
  let requests = 0;
  const store = createHighlightStore({ url: "https://example.supabase.co", secretKey: "sb_secret_test" },
    (async (_, init) => {
      requests++;
      assert.equal(init?.method, "GET");
      return Response.json([{ published_at: "2026-08-31T00:00:30Z", highlight_articles: rows }]);
    }) as typeof fetch);
  const result = await store.current("2026-08-31");
  assert.equal(result?.publishedAt, "2026-08-31T00:00:30Z");
  assert.equal(result?.articles[0]?.title, generated.title);
  assert.equal(result?.articles[0]?.generationMethod, "ai");
  assert.equal(result?.articles[1]?.title, "Original");
  assert.equal(result?.articles[1]?.generationMethod, "fallback");
  assert.equal(JSON.stringify(result).includes("private-token"), false);
  assert.equal(requests, 1);
});

test("repair storage sends only the scoped RPC payload and refuses fallback results", async () => {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const store = createHighlightStore({ url: "https://example.supabase.co", secretKey: "sb_secret_test" },
    (async (url, init) => {
      requests.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)) });
      return Response.json(String(url).includes("claim_") ? { outcome: "unavailable" } : true);
    }) as typeof fetch);
  await store.claimRepair("2026-08-31", 2);
  assert.equal(await store.saveRepair("2026-08-31", 2, "repair-token", generated), true);
  assert.equal(await store.saveRepair("2026-08-31", 2, "repair-token", { ...generated, generationMethod: "fallback" }), false);
  assert.deepEqual(requests, [
    { path: "/rest/v1/rpc/claim_highlight_fallback_repair", body: { p_week_start: "2026-08-31", p_slot: 2 } },
    { path: "/rest/v1/rpc/save_highlight_fallback_repair", body: { p_week_start: "2026-08-31", p_slot: 2,
      p_repair_token: "repair-token", p_title: generated.title, p_paragraphs: generated.paragraphs, p_model: generated.model } },
  ]);
});

test("a 429 is recorded with its delay and leaves the second profile unattempted", async () => {
  const { store, attempts, recordedFailures } = fixture();
  let calls = 0;
  const result = await repairWeeklyHighlight({ store, now, generate: async () => {
    calls++;
    throw new HighlightGenerationError("provider", "http_error", 429, 120);
  } });
  assert.deepEqual(result, { outcome: "unchanged", attempted: 1, repaired: 0, failures: 1 });
  assert.equal(calls, 1);
  assert.deepEqual([...attempts], [1]);
  assert.deepEqual(recordedFailures.get(1), { code: "rate_limited", httpStatus: 429, retryAfterSeconds: 120 });
});

test("explicit retries pass the admin flag and report cooldown without calling Mistral", async () => {
  const { store } = fixture();
  const skipped: unknown[] = [];
  store.claimRepair = async (_, slot, retryFailed) => {
    assert.equal(retryFailed, true);
    return { outcome: slot === 1 ? "cooldown" : "attempted" };
  };
  const result = await repairWeeklyHighlight({ store, now, retryFailed: true,
    onSkip: (slot, outcome) => skipped.push({ slot, outcome }),
    generate: async () => { throw new Error("Must not call Mistral during cooldown."); },
  });
  assert.deepEqual(result, { outcome: "unchanged", attempted: 0, repaired: 0, failures: 0 });
  assert.deepEqual(skipped, [{ slot: 1, outcome: "cooldown" }, { slot: 2, outcome: "attempted" }]);
});

test("failed failure bookkeeping stops the job and ambiguous saves are not misclassified as provider errors", async () => {
  const first = fixture();
  first.store.recordRepairFailure = async () => false;
  let calls = 0;
  await assert.rejects(repairWeeklyHighlight({ store: first.store, now, generate: async () => {
    calls++;
    throw new HighlightGenerationError("provider", "http_error", 429);
  } }), /Unable to record/);
  assert.equal(calls, 1);
  const second = fixture();
  second.store.saveRepair = async () => { throw new Error("Connection lost after possible commit."); };
  await repairWeeklyHighlight({ store: second.store, now, generate: async () => generated });
  assert.equal(second.recordedFailures.size, 0);
});

test("retry and failure recording RPC payloads contain only bounded diagnostic fields", async () => {
  const requests: unknown[] = [];
  const store = createHighlightStore({ url: "https://example.supabase.co", secretKey: "sb_secret_test" },
    (async (url, init) => {
      requests.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)) });
      return Response.json(true);
    }) as typeof fetch);
  await store.claimRepair("2026-08-31", 1, true);
  await store.recordRepairFailure("2026-08-31", 1, "token", { code: "rate_limited", httpStatus: 429, retryAfterSeconds: 180 });
  assert.deepEqual(requests, [
    { path: "/rest/v1/rpc/claim_highlight_fallback_repair", body: { p_week_start: "2026-08-31", p_slot: 1, p_retry_failed: true } },
    { path: "/rest/v1/rpc/record_highlight_repair_failure", body: { p_week_start: "2026-08-31", p_slot: 1,
      p_repair_token: "token", p_failure_code: "rate_limited", p_http_status: 429, p_retry_after_seconds: 180 } },
  ]);
});
