import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createMentorshipRepository } from "../../../src/lib/mentorshipData.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1);
const peer = id(2);
const other = id(3);
const member = (memberId: string) => ({
  id: memberId, first_name: "Awa", last_name: "Test", member_role: "alumni",
  graduation_year: 2020, specialty: "Sciences", offers_mentoring: false, photo_url: null,
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

test("my connections show the other member of each pair, whichever side I am on", async () => {
  const rows = [
    { id: id(11), member_a: owner, member_b: peer, request_id: id(21), created_at: "2026-11-02T10:00:00Z", first: member(owner), second: member(peer) },
    { id: id(10), member_a: other, member_b: owner, request_id: id(20), created_at: "2026-11-01T10:00:00Z", first: null, second: member(owner) },
  ];
  const repo = repository((url) => {
    assert.equal(url.pathname, "/rest/v1/member_connections");
    assert.equal(url.searchParams.get("or"), `(member_a.eq.${owner},member_b.eq.${owner})`);
    return json(url.searchParams.has("id") ? [] : rows);
  });
  const connections = await repo.loadMemberConnections(owner);
  assert.deepEqual(connections.map((connection) => [connection.id, connection.peerId, connection.peer?.id ?? null]), [
    [id(11), peer, peer],
    [id(10), other, null],
  ]);
  assert.equal(connections[0]?.requestId, id(21));
});

test("the connection with a profile is looked up in the pair's stored order", async () => {
  const seen: string[] = [];
  const repo = repository((url) => {
    seen.push(`${url.searchParams.get("member_a")} ${url.searchParams.get("member_b")}`);
    return json(seen.length === 1 ? [] : [{ id: id(12) }]);
  });
  assert.equal(await repo.findMemberConnection(peer, owner), null);
  assert.deepEqual(await repo.findMemberConnection(owner, peer), { id: id(12) });
  assert.deepEqual(seen, [`eq.${owner} eq.${peer}`, `eq.${owner} eq.${peer}`]);
  await assert.rejects(repo.findMemberConnection(owner, "not-an-id"), /introuvable/);
});

test("removing a connection that is already gone says so", async () => {
  let method = "";
  const repo = repository((url, init) => {
    method = init.method ?? "GET";
    assert.equal(url.searchParams.get("id"), `eq.${id(12)}`);
    return json([]);
  });
  await assert.rejects(repo.removeMemberConnection(id(12)), /déjà été retirée/);
  assert.equal(method, "DELETE");
});

test("a request crossing the other member's request explains what to do", () => {
  const repo = repository(() => json([]));
  const crossing = { code: "23505", message: "A connection request from this member is already waiting for your answer" };
  assert.match(repo.getConnectionErrorMessage(crossing), /vous a déjà envoyé une demande/);
  assert.match(repo.getConnectionErrorMessage({ code: "23505", message: "These members are already connected" }), /existe déjà/);
});
