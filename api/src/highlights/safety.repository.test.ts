import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createSafetyRepository, SafetyActionError } from "../../../src/lib/safetyData.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const blocked = id(2);
const member = (memberId: string) => ({
  id: memberId, first_name: "Awa", last_name: "Test", member_role: "alumni",
  graduation_year: 2020, specialty: "Sciences", offers_mentoring: false, photo_url: null,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
type Seen = { method: string; path: string; params: URLSearchParams; body: unknown };

function repository(answer: (seen: Seen) => Response = () => json(null)) {
  const calls: Seen[] = [];
  const client = createClient("https://database.example", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const seen = { method: init?.method ?? "GET", path: url.pathname, params: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null };
        calls.push(seen);
        return answer(seen);
      },
    },
  });
  return { repo: createSafetyRepository(client), calls };
}

test("blocking a member asks the database to block and tidy up in one call", async () => {
  const { repo, calls } = repository();
  await repo.blockMember(blocked);
  assert.deepEqual(calls.map(({ method, path, body }) => [method, path, body]), [["POST", "/rest/v1/rpc/block_member", { p_member_id: blocked }]]);
});

test("lifting a block deletes the member's own block on that member", async () => {
  const { repo, calls } = repository(() => new Response(null, { status: 204 }));
  await repo.unblockMember(blocked);
  assert.equal(calls[0]?.method, "DELETE");
  assert.equal(calls[0]?.path, "/rest/v1/member_blocks");
  assert.equal(calls[0]?.params.get("blocked_id"), `eq.${blocked}`);
});

test("a profile knows whether the member has blocked it", async () => {
  let rows: unknown[] = [{ blocked_id: blocked }];
  const { repo, calls } = repository(() => json(rows));
  assert.equal(await repo.hasBlocked(blocked), true);
  rows = [];
  assert.equal(await repo.hasBlocked(blocked), false);
  assert.equal(calls[0]?.params.get("blocked_id"), `eq.${blocked}`);
});

test("blocked members are listed newest first, even when their profile is no longer visible", async () => {
  const { repo, calls } = repository(() => json([
    { blocked_id: blocked, created_at: "2026-11-09T10:00:00Z", blocked: member(blocked) },
    { blocked_id: id(3), created_at: "2026-11-08T10:00:00Z", blocked: null },
  ]));
  const list = await repo.loadBlockedMembers();
  assert.deepEqual(list.map((item) => [item.memberId, item.member?.firstName ?? null, item.blockedAt]), [
    [blocked, "Awa", "2026-11-09T10:00:00Z"],
    [id(3), null, "2026-11-08T10:00:00Z"],
  ]);
  assert.equal(calls[0]?.params.get("order"), "created_at.desc");
  assert.match(calls[0]?.params.get("select") ?? "", /blocked:profiles!member_blocks_blocked_id_fkey\(id,first_name,/);
});

test("an identifier that is not a member id never reaches the database", async () => {
  const { repo, calls } = repository();
  for (const action of [repo.blockMember, repo.unblockMember, repo.hasBlocked]) {
    await assert.rejects(action("1,blocked_id.neq.0"), SafetyActionError);
  }
  assert.equal(calls.length, 0);
});

test("safety errors are worded for members", () => {
  const { repo } = repository();
  assert.match(repo.getSafetyErrorMessage(new SafetyActionError("Ce membre est introuvable.")), /introuvable/);
  assert.match(repo.getSafetyErrorMessage({ code: "P0002", message: "Member not found" }), /introuvable/);
  assert.match(repo.getSafetyErrorMessage({ code: "42501", message: "secret detail" }), /pas autorisée/);
  assert.match(repo.getSafetyErrorMessage({ code: "LS422", message: "You cannot block yourself" }), /vous-même/);
  assert.doesNotMatch(repo.getSafetyErrorMessage({ code: "XX000", message: "secret detail" }), /secret/);
  for (const error of [null, "LS422", new Error("secret detail")]) {
    assert.match(repo.getSafetyErrorMessage(error), /Réessayez dans un instant/);
  }
});

test("without a database, safety actions say they are unavailable", async () => {
  const repo = createSafetyRepository(null);
  await assert.rejects(repo.blockMember(blocked), /indisponible/);
});
