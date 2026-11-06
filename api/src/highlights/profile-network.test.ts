import assert from "node:assert/strict";
import test from "node:test";
import type { MemberConnection, MemberSummary, MentorshipNetwork } from "../../../src/lib/mentorshipData.ts";
import { initialNetworkGroup, networkGroups } from "../../../src/lib/profileNetwork.ts";

const member = (id: string) => ({ id, firstName: id, lastName: "Test" }) as MemberSummary;
const network = (mentors: string[], mentees: string[]) => ({
  mentors: mentors.map((id) => ({ mentor: member(id) })),
  mentees: mentees.map((id) => ({ mentee: member(id) })),
}) as unknown as MentorshipNetwork;
const connection = (peer: MemberSummary | null) => ({ peer }) as MemberConnection;
const summary = (groups: ReturnType<typeof networkGroups>) =>
  groups.map((group) => `${group.key}:${group.members.map((item) => item.id).join(",")}`);

test("a member's own profile lists their network members first, then mentees and mentors", () => {
  const groups = networkGroups({ mentorships: network(["m1"], ["e1", "e2"]), connections: [connection(member("c1")), connection(null)] }, true);
  assert.deepEqual(summary(groups), ["connections:c1", "mentees:e1,e2", "mentors:m1"]);
  assert.equal(initialNetworkGroup(groups, true), "connections");
  assert.equal(initialNetworkGroup(networkGroups({ mentorships: network([], ["e1"]), connections: [] }, true), true), "mentees");
  assert.equal(initialNetworkGroup(networkGroups({ mentorships: network([], []) }, true), true), "connections");
});

test("another member's profile shows only their mentorships, opening on their mentees when they have some", () => {
  const groups = networkGroups({ mentorships: network(["m1"], []), connections: [connection(member("c1"))] }, false);
  assert.deepEqual(summary(groups), ["mentors:m1", "mentees:"]);
  assert.equal(initialNetworkGroup(groups, false), "mentors");
  assert.equal(initialNetworkGroup(networkGroups({ mentorships: network(["m1"], ["e1"]) }, false), false), "mentees");
});
