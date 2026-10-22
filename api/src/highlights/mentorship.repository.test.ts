import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createMentorshipRepository } from "../../../src/lib/mentorshipData.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1);
const mentor = id(2);
const member = (memberId: string) => ({
  id: memberId, first_name: "Awa", last_name: "Test", member_role: "alumni",
  graduation_year: 2020, specialty: "Sciences", offers_mentoring: true, photo_url: null,
});
const request = (n: number) => ({
  id: id(n), requester_id: owner, recipient_id: mentor, request_kind: "mentoring", status: "pending",
  message: "Je souhaite échanger sur mon orientation.", created_at: `2026-10-${String(n).padStart(2, "0")}T12:00:00Z`,
  responded_at: null, requester: member(owner), recipient: member(mentor),
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

function repository(fetcher: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const client = createClient("https://database.example", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => fetcher(new URL(String(input)), init ?? {}) },
  });
  return createMentorshipRepository(client);
}

test("request lists survive a low API row cap and retain unavailable participants", async () => {
  const rows = [request(4), { ...request(3), recipient: null }];
  let calls = 0;
  const repo = repository((url) => {
    calls++;
    assert.equal(url.pathname, "/rest/v1/connection_requests");
    assert.equal(url.searchParams.get("or"), `(requester_id.eq.${owner},recipient_id.eq.${owner})`);
    const before = url.searchParams.get("id")?.slice(3);
    return json(rows.filter((row) => !before || row.id < before).slice(0, 1));
  });
  const result = await repo.loadConnectionRequests(owner);
  assert.equal(calls, 3);
  assert.deepEqual(result.map((row) => row.id), [id(4), id(3)]);
  assert.equal(result[1]?.recipient, null);
});

test("a failed later page rejects the entire load instead of showing incomplete counts", async () => {
  const repo = repository((url) => url.searchParams.has("id")
    ? json({ code: "XX000", message: "private backend diagnostic" }, 500)
    : json([request(4)]));
  await assert.rejects(repo.loadConnectionRequests(owner), (error: unknown) => {
    assert.doesNotMatch(repo.getConnectionErrorMessage(error), /private backend diagnostic/);
    return true;
  });
});

test("the public network loads both directions with active profile joins and no request content", async () => {
  const rows = [
    { id: id(5), mentor_id: mentor, mentee_id: owner, created_at: "2026-10-21T10:00:00Z", mentor: member(mentor), mentee: member(owner) },
    { id: id(4), mentor_id: owner, mentee_id: mentor, created_at: "2026-10-20T10:00:00Z", mentor: member(owner), mentee: member(mentor) },
  ];
  const repo = repository((url) => {
    assert.equal(url.pathname, "/rest/v1/mentorships");
    assert.equal(url.searchParams.get("ended_at"), "is.null");
    for (const side of ["mentor", "mentee"]) {
      assert.equal(url.searchParams.get(`${side}.is_active`), "eq.true");
      assert.equal(url.searchParams.get(`${side}.profile_completed`), "eq.true");
    }
    assert.match(url.searchParams.get("select")!, /!inner/);
    assert.doesNotMatch(url.searchParams.get("select")!, /message|request_id|email/);
    const before = url.searchParams.get("id")?.slice(3);
    return json(rows.filter((row) => !before || row.id < before).slice(0, 1));
  });
  const network = await repo.loadMentorshipNetwork(owner);
  assert.equal(network.mentors.length, 1);
  assert.equal(network.mentees.length, 1);
  assert.equal(network.mentors[0]?.mentor?.id, mentor);
  assert.equal(network.mentees[0]?.mentee?.id, mentor);
});

test("participants retain an unavailable partner so they can still end the relationship", async () => {
  const repo = repository((url) => {
    assert.doesNotMatch(url.searchParams.get("select")!, /!inner/);
    assert.equal(url.searchParams.has("mentor.is_active"), false);
    return json(url.searchParams.has("id") ? [] : [{
      id: id(5), mentor_id: mentor, mentee_id: owner, created_at: "2026-10-21T10:00:00Z", mentor: null, mentee: member(owner),
    }]);
  });
  const relations = await repo.loadActiveMentorships(owner);
  assert.equal(relations.length, 1);
  assert.equal(relations[0]?.mentor, null);
});

test("zero-row stale writes never report a successful answer, withdrawal or ending", async () => {
  const repo = repository(() => json([]));
  await assert.rejects(repo.answerConnectionRequest(id(4), "accepted"), /déjà été traitée/);
  await assert.rejects(repo.withdrawConnectionRequest(id(4)), /déjà été traitée/);
  await assert.rejects(repo.endMentorship(id(5)), /déjà terminé/);
});

test("creation cannot supply an accepted state and actions send only their permitted transition", async () => {
  const writes: { url: URL; body: Record<string, unknown> }[] = [];
  const repo = repository((url, init) => {
    writes.push({ url, body: JSON.parse(String(init.body)) });
    return json(init.method === "POST" ? null : [{ id: id(4) }]);
  });
  await repo.createConnectionRequest(owner, mentor, "mentoring", "  Je souhaite échanger sur mon orientation.  ");
  await repo.answerConnectionRequest(id(4), "accepted");
  await repo.endMentorship(id(5));
  assert.deepEqual(writes[0]?.body, { requester_id: owner, recipient_id: mentor, request_kind: "mentoring", message: "Je souhaite échanger sur mon orientation." });
  assert.deepEqual(writes[1]?.body, { status: "accepted" });
  assert.equal(writes[1]?.url.searchParams.get("status"), "eq.pending");
  assert.deepEqual(Object.keys(writes[2]!.body), ["ended_at"]);
  assert.equal(writes[2]?.url.searchParams.get("ended_at"), "is.null");
});

test("invalid IDs, self requests and invalid messages fail before sending any query", async () => {
  let calls = 0;
  const repo = repository(() => { calls++; return json([]); });
  await assert.rejects(repo.loadProfileConnections(owner, `${mentor},requester_id.neq.anything`));
  await assert.rejects(repo.createConnectionRequest(owner, owner, "mentoring", request(4).message));
  await assert.rejects(repo.createConnectionRequest(owner, mentor, "mentoring", "   court   "));
  await assert.rejects(repo.createConnectionRequest(owner, mentor, "mentoring", "x".repeat(1201)));
  assert.equal(calls, 0);
});

test("the header badge counts only pending requests received by the member, without loading them", async () => {
  const repo = repository((url, init) => {
    assert.equal(init.method, "HEAD");
    assert.equal(url.pathname, "/rest/v1/connection_requests");
    assert.equal(url.searchParams.get("recipient_id"), `eq.${owner}`);
    assert.equal(url.searchParams.get("status"), "eq.pending");
    assert.match(new Headers(init.headers).get("Prefer") ?? "", /count=exact/);
    return new Response(null, { status: 200, headers: { "Content-Range": "*/3" } });
  });
  assert.equal(await repo.countPendingReceivedRequests(owner), 3);
});

test("a failed badge count rejects instead of reading as zero", async () => {
  let calls = 0;
  const repo = repository(() => { calls++; return json({ code: "XX000", message: "private backend diagnostic" }, 500); });
  await assert.rejects(repo.countPendingReceivedRequests(`${owner},status.neq.pending`));
  assert.equal(calls, 0);
  await assert.rejects(repo.countPendingReceivedRequests(owner));
  assert.equal(calls, 1);
});
