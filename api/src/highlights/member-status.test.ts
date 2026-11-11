import assert from "node:assert/strict";
import test from "node:test";
import { memberPageAccess, memberStatusOf, offerAccessOf, profileGateKind } from "../../../src/lib/memberStatus.ts";

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

const signedIn = { isLoading: false, isSignedIn: true, profileError: false, allowIncomplete: false, allowPending: false };

test("a members-only page waits for the session, then for the profile, before it decides", () => {
  assert.equal(memberPageAccess({ ...signedIn, isLoading: true, status: null }), "loading-session");
  assert.equal(memberPageAccess({ ...signedIn, status: null }), "loading-profile");
  assert.equal(memberPageAccess({ ...signedIn, isSignedIn: false, status: null }), "sign-in");
  assert.equal(memberPageAccess({ ...signedIn, profileError: true, status: null }), "profile-error");
});

test("a members-only page sends an unfinished profile to onboarding and tells a waiting account it waits", () => {
  assert.equal(memberPageAccess({ ...signedIn, status: "incomplete" }), "complete-profile");
  assert.equal(memberPageAccess({ ...signedIn, status: "pending" }), "pending");
  assert.equal(memberPageAccess({ ...signedIn, status: "active" }), "allowed");
});

test("onboarding opens to any signed-in account; the profile editor also to a waiting one", () => {
  assert.equal(memberPageAccess({ ...signedIn, allowIncomplete: true, status: "incomplete" }), "allowed");
  assert.equal(memberPageAccess({ ...signedIn, allowIncomplete: true, profileError: true, status: null }), "allowed");
  assert.equal(memberPageAccess({ ...signedIn, allowPending: true, status: "pending" }), "allowed");
  assert.equal(memberPageAccess({ ...signedIn, allowPending: true, status: "incomplete" }), "complete-profile");
});

test("offers open to active members only, and say what everyone else needs", () => {
  const reader = { isConfigured: true, isLoading: false, isSignedIn: true, profileError: false };
  assert.equal(offerAccessOf({ ...reader, isConfigured: false, status: null }), "demo");
  assert.equal(offerAccessOf({ ...reader, isLoading: true, status: null }), "checking");
  assert.equal(offerAccessOf({ ...reader, isSignedIn: false, status: null }), "members-only");
  assert.equal(offerAccessOf({ ...reader, profileError: true, status: null }), "profile-error");
  assert.equal(offerAccessOf({ ...reader, status: null }), "checking");
  assert.equal(offerAccessOf({ ...reader, status: "incomplete" }), "incomplete");
  assert.equal(offerAccessOf({ ...reader, status: "pending" }), "pending");
  assert.equal(offerAccessOf({ ...reader, status: "active" }), "member");
});
