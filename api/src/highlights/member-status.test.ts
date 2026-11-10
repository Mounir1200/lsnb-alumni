import assert from "node:assert/strict";
import test from "node:test";
import { memberStatusOf, profileGateKind } from "../../../src/lib/memberStatus.ts";

test("an account completes its profile, then waits for its promotion's approval, then is an active member", () => {
  assert.equal(memberStatusOf({ profile_completed: false, approval_pending: false }), "incomplete");
  assert.equal(memberStatusOf({ profile_completed: true, approval_pending: true }), "pending");
  assert.equal(memberStatusOf({ profile_completed: true, approval_pending: false }), "active");
});

test("a profile's gate invites a visitor to join, an unfinished account to complete its profile, a waiting one to wait", () => {
  assert.equal(profileGateKind({ isSignedIn: false, status: null }), "join");
  assert.equal(profileGateKind({ isSignedIn: true, status: "incomplete" }), "complete");
  assert.equal(profileGateKind({ isSignedIn: true, status: "pending" }), "wait");
});
