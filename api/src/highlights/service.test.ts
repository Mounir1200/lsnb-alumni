import assert from "node:assert/strict";
import test from "node:test";
import { generateWeeklyHighlight } from "./service.js";
import { createHighlightStore, HighlightStorageError } from "./store.js";
import type { GeneratedArticle, HighlightStore, SourceProfile, StoredArticle } from "./types.js";
import { currentWeekStart, weekEnd } from "./week.js";

const source: SourceProfile = {
  id: "member-1", first_name: "Awa", last_name: "Sanou", graduation_year: 2020,
  specialty: "Mathématiques", specialties: ["Mathématiques"], domain: null,
  city: "Bobo-Dioulasso", country: "Burkina Faso", experience: "Je travaille sur des modèles statistiques.",
  photo_url: null, offers_mentoring: false, mentoring_topics: [],
};
const generated: GeneratedArticle = { title: "Awa Sanou", paragraphs: ["Un parcours en mathématiques."], generationMethod: "ai", model: "test" };

function fixture() {
  const articles: StoredArticle[] = [1, 2].map((slot) => ({
    slot, profile_id: `member-${slot}`, source_profile: { ...source, id: `member-${slot}` },
    title: null, paragraphs: null, generation_method: null, ai_attempted_at: null, generated_at: null,
  }));
  let published = false;
  let busy = false;
  const store: HighlightStore = {
    current: async () => null,
    claim: async () => published ? { outcome: "published" } : busy ? { outcome: "busy" } : (
      busy = true, { outcome: "claimed", lease_token: "lease", articles: structuredClone(articles) }
    ),
    claimAi: async (_, slot) => {
      const row = articles[slot - 1]!;
      if (row.ai_attempted_at) return false;
      row.ai_attempted_at = "2026-09-07T00:00:00Z";
      return true;
    },
    save: async (_, slot, __, result) => {
      Object.assign(articles[slot - 1]!, {
        title: result.title, paragraphs: result.paragraphs, generation_method: result.generationMethod,
        generated_at: "2026-09-07T00:00:00Z",
      });
      return true;
    },
    publish: async () => (published = true),
  };
  return { store, articles, expireLease: () => { busy = false; } };
}

test("weeks switch only on Monday midnight in Burkina Faso, including year boundaries", () => {
  assert.equal(currentWeekStart(new Date("2026-09-06T23:59:59Z")), "2026-08-31");
  assert.equal(currentWeekStart(new Date("2026-09-07T00:00:00Z")), "2026-09-07");
  assert.equal(currentWeekStart(new Date("2027-01-01T12:00:00Z")), "2026-12-28");
  assert.equal(weekEnd("2026-12-28"), "2027-01-03");
});

test("two concurrent runs and a later rerun consume only two AI calls", async () => {
  const { store } = fixture();
  let calls = 0;
  const generate = async () => { calls++; return generated; };
  const outcomes = await Promise.all([generateWeeklyHighlight({ store, generate }), generateWeeklyHighlight({ store, generate })]);
  assert.deepEqual(outcomes.map((result) => result.outcome).sort(), ["busy", "published"]);
  assert.equal((await generateWeeklyHighlight({ store, generate })).generated, 0);
  assert.equal(calls, 2);
});

test("AI failure is stored as a factual fallback without another billed attempt", async () => {
  const { store, articles } = fixture();
  let calls = 0;
  const generate = async () => { calls++; throw new Error("provider failed"); };
  const result = await generateWeeklyHighlight({ store, generate });
  assert.equal(result.fallbacks, 2);
  assert.equal(calls, 2);
  assert.ok(articles.every((article) => article.generation_method === "fallback"));
  await generateWeeklyHighlight({ store, generate });
  assert.equal(calls, 2);
});

test("resume after lost save preserves saved article and never recalls AI for attempted one", async () => {
  const { store, articles, expireLease } = fixture();
  const realSave = store.save;
  let calls = 0;
  const generate = async () => { calls++; return generated; };
  store.save = async (...args) => args[1] === 2 ? Promise.reject(new Error("connection lost")) : realSave(...args);
  await assert.rejects(generateWeeklyHighlight({ store, generate }), /connection lost/);
  assert.equal(calls, 2);
  assert.ok(articles[0]!.generated_at);
  assert.ok(articles[1]!.ai_attempted_at);
  expireLease();
  store.save = realSave;
  const resumed = await generateWeeklyHighlight({ store, generate });
  assert.equal(calls, 2);
  assert.equal(resumed.fallbacks, 1);
  assert.equal(resumed.generated, 1);
  assert.equal(articles[0]!.generation_method, "ai");
});

test("a rejected AI claim stops processing before any provider request or save", async () => {
  const { store } = fixture();
  store.claimAi = async () => false;
  let calls = 0;
  await assert.rejects(generateWeeklyHighlight({ store, generate: async () => { calls++; return generated; } }), /lease/);
  assert.equal(calls, 0);
});

test("insufficient pool and busy edition never invoke Mistral", async () => {
  const { store } = fixture();
  let calls = 0;
  for (const outcome of ["empty", "busy", "published"] as const) {
    store.claim = async () => ({ outcome });
    assert.equal((await generateWeeklyHighlight({ store, generate: async () => { calls++; return generated; } })).outcome, outcome);
  }
  assert.equal(calls, 0);
});

test("public read exposes only the saved portraits and applies active alumni filters", async () => {
  let requestedUrl = "";
  let requestedHeaders: HeadersInit | undefined;
  const rows = [1, 2].map((slot) => ({
    slot, profile_id: `member-${slot}`, source_profile: { ...source, email: "private@example.test", gender: "female" },
    title: generated.title, paragraphs: generated.paragraphs, generation_method: "ai",
    profiles: { is_active: true, member_role: "alumni" },
  }));
  const mockFetch = (async (url, init) => {
    requestedUrl = String(url);
    requestedHeaders = init?.headers;
    return Response.json([{ published_at: "2026-09-07T00:00:30Z", highlight_articles: rows }]);
  }) as typeof fetch;
  const store = createHighlightStore({ url: "https://example.supabase.co", secretKey: "sb_secret_test" }, mockFetch);
  const response = await store.current("2026-09-07");
  assert.equal(response?.articles.length, 2);
  assert.equal(response?.weekEnd, "2026-09-13");
  assert.equal(JSON.stringify(response).includes("private@example.test"), false);
  assert.equal(JSON.stringify(response).includes("gender"), false);
  assert.equal(new URL(requestedUrl).searchParams.get("highlight_articles.profiles.member_role"), "eq.alumni");
  assert.equal(new Headers(requestedHeaders).get("apikey"), "sb_secret_test");
  assert.equal(new Headers(requestedHeaders).has("authorization"), false);
  rows[0]!.profiles.is_active = false;
  assert.equal(await store.current("2026-09-07"), null);
  rows[0]!.profiles.is_active = true;
  rows[0]!.profiles.member_role = "student";
  assert.equal(await store.current("2026-09-07"), null);
});

test("storage failure never exposes provider response or credentials", async () => {
  const store = createHighlightStore({ url: "https://example.supabase.co", secretKey: "secret" },
    (async () => new Response("private profile and credentials", { status: 403 })) as typeof fetch);
  await assert.rejects(store.current("2026-09-07"), (error) => {
    assert.ok(error instanceof HighlightStorageError);
    assert.equal(error.status, 403);
    assert.equal(error.message.includes("private"), false);
    return true;
  });
});
