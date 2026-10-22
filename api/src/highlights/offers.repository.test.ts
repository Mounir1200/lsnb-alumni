import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createMentorshipRepository } from "../../../src/lib/mentorshipData.ts";
import { createOfferRepository, todayIsoDate, type OfferDraft } from "../../../src/lib/offerData.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = id(1);
const student = id(2);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const draft: OfferDraft = {
  kind: "scholarship", title: "  Bourse de master  ", organization: " Fondation ", location: "  ",
  description: "  Une bourse complète pour deux années de master en sciences.  ", linkUrl: " https://example.org/bourse ", deadline: "",
};
const offerRow = (n: number) => ({
  id: id(n), author_id: author, kind: "internship", title: "Stage", organization: "Laboratoire", location: "",
  description: "Un stage de six mois dans une équipe de recherche.", link_url: "https://localhost/interne",
  deadline: null, created_at: `2026-10-${String(n).padStart(2, "0")}T12:00:00Z`,
  author: { id: author, first_name: "Awa", last_name: "Test", member_role: "alumni", graduation_year: 2019, specialty: "Data", offers_mentoring: true, photo_url: null },
});

function client(fetcher: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return createClient("https://database.example", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => fetcher(new URL(String(input)), init ?? {}) },
  });
}

test("offer lists survive a low API row cap and never expose an unsafe stored link", async () => {
  const rows = [offerRow(4), offerRow(3)];
  let calls = 0;
  const repo = createOfferRepository(client((url) => {
    calls++;
    assert.equal(url.pathname, "/rest/v1/offers");
    assert.match(url.searchParams.get("select")!, /author:profiles!offers_author_id_fkey/);
    const before = url.searchParams.get("id")?.slice(3);
    return json(rows.filter((row) => !before || row.id < before).slice(0, 1));
  }));
  const offers = await repo.loadOffers();
  assert.equal(calls, 3);
  assert.deepEqual(offers.map((offer) => offer.id), [id(4), id(3)]);
  assert.equal(offers[0]?.linkUrl, undefined);
  assert.equal(offers[0]?.author?.firstName, "Awa");
});

test("publishing sends a trimmed, normalized draft for the signed-in author", async () => {
  const writes: Record<string, unknown>[] = [];
  const repo = createOfferRepository(client((_url, init) => {
    writes.push(JSON.parse(String(init.body)));
    return json({ id: id(9) });
  }));
  assert.equal(await repo.createOffer(author, draft), id(9));
  assert.deepEqual(writes[0], {
    author_id: author, kind: "scholarship", title: "Bourse de master", organization: "Fondation", location: "",
    description: "Une bourse complète pour deux années de master en sciences.", link_url: "https://example.org/bourse", deadline: null,
  });
});

test("invalid drafts fail with a readable message before any request", async () => {
  let calls = 0;
  const repo = createOfferRepository(client(() => { calls++; return json({ id: id(9) }); }));
  const cases: [Partial<OfferDraft>, RegExp][] = [
    [{ title: "abc" }, /intitulé/],
    [{ description: "Trop court" }, /description/],
    [{ linkUrl: "http://example.org" }, /lien de l’offre/],
    [{ linkUrl: "https://192.168.1.2/offre" }, /lien de l’offre/],
    [{ deadline: "2000-01-01" }, /déjà passée/],
  ];
  for (const [change, message] of cases) {
    await assert.rejects(repo.createOffer(author, { ...draft, ...change }), (error: unknown) => {
      assert.match(repo.getOfferErrorMessage(error), message);
      return true;
    });
  }
  await assert.rejects(repo.createOffer(`${author},author_id.neq.x`, draft));
  assert.equal(calls, 0);
});

test("editing keeps an unchanged expired deadline and reports writes that matched nothing", async () => {
  const repo = createOfferRepository(client((url) => {
    assert.equal(url.searchParams.get("id"), `eq.${id(4)}`);
    return json([]);
  }));
  const expired = { id: id(4), deadline: "2000-01-01" };
  await assert.rejects(repo.updateOffer(expired, { ...draft, deadline: "2000-01-01" }), /n’existe plus/);
  await assert.rejects(repo.updateOffer(expired, { ...draft, deadline: "2000-01-02" }), /déjà passée/);
  await assert.rejects(repo.deleteOffer(id(4)), /déjà été supprimée/);
  assert.ok(todayIsoDate() > "2000-01-01");
});

test("an offer question is sent as a contact request carrying the offer reference", async () => {
  const writes: Record<string, unknown>[] = [];
  const repo = createMentorshipRepository(client((_url, init) => {
    writes.push(JSON.parse(String(init.body)));
    return json(null);
  }));
  await repo.createConnectionRequest(student, author, "contact", "  Quelles sont les dates de l’entretien ?  ", id(4));
  assert.deepEqual(writes[0], {
    requester_id: student, recipient_id: author, request_kind: "contact",
    message: "Quelles sont les dates de l’entretien ?", offer_id: id(4),
  });
  await assert.rejects(repo.createConnectionRequest(student, author, "contact", "Une question suffisamment longue.", "offre,id.neq.x"));
  assert.equal(writes.length, 1);
});
