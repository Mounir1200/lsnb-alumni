import assert from "node:assert/strict";
import test from "node:test";
import { hubLinkFor, loadHubAccess, teamHubUrl, type HubAccessClient } from "../../../src/lib/teamHub.ts";

const answering = (outcome: { data: unknown; error: unknown }, calls: string[] = []): HubAccessClient => ({
  rpc: async (name) => {
    calls.push(name);
    return outcome;
  },
});

test("a team member's own account opens the hub link, asked through has_hub_access", async () => {
  const calls: string[] = [];
  assert.equal(await loadHubAccess(answering({ data: true, error: null }, calls)), true);
  assert.deepEqual(calls, ["has_hub_access"]);
});

test("any other answer, an error or a site without Supabase keeps the link hidden", async () => {
  for (const outcome of [
    { data: false, error: null },
    { data: "true", error: null },
    { data: 1, error: null },
    { data: null, error: null },
    { data: true, error: { message: "permission denied" } },
  ]) {
    assert.equal(await loadHubAccess(answering(outcome)), false, JSON.stringify(outcome));
  }
  assert.equal(await loadHubAccess(null), false);
});

test("the link shows only when the answer about this very account opens the hub", () => {
  const hub = "https://hub.example.test";
  assert.equal(hubLinkFor("member-1", { userId: "member-1", isOpen: true }, hub), hub);
  assert.equal(hubLinkFor("member-2", { userId: "member-1", isOpen: true }, hub), null, "an answer left from another session");
  assert.equal(hubLinkFor("member-1", { userId: "member-1", isOpen: false }, hub), null);
  assert.equal(hubLinkFor("member-1", null, hub), null, "while the answer is on its way");
  assert.equal(hubLinkFor("member-1", { userId: "member-1", isOpen: true }, null), null, "a site without a hub");
});

test("the hub's address comes from VITE_HUB_URL; without it the site links to no hub", () => {
  assert.equal(teamHubUrl({ VITE_HUB_URL: " https://hub.example.test " }), "https://hub.example.test");
  for (const VITE_HUB_URL of [undefined, "", "   "]) assert.equal(teamHubUrl({ VITE_HUB_URL }), null);
});
