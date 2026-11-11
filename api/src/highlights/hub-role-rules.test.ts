import assert from "node:assert/strict";
import test from "node:test";
import { assignableRoles, canRemoveRole, coversNetwork, hasRole, isRole, type Role } from "../../../src/hub/roles.ts";

const roles: Role[] = ["moderator", "admin", "super_admin"];

test("each level holds the powers of the levels below it, never those above", () => {
  assert.deepEqual(roles.map((role) => roles.filter((minimum) => hasRole(role, minimum))), [
    ["moderator"], ["moderator", "admin"], ["moderator", "admin", "super_admin"],
  ]);
});

test("administrators and super administrators work network-wide, a moderator within a promotion", () => {
  assert.deepEqual(roles.map(coversNetwork), [false, true, true]);
});

test("a team member hands out the roles below their own; super administrators also appoint their peers", () => {
  assert.deepEqual(roles.map(assignableRoles), [[], ["moderator"], ["moderator", "admin", "super_admin"]]);
});

test("the hub removes only roles below one's own, and never a super administrator", () => {
  const removable = (actor: Role) => roles.filter((target) => canRemoveRole(actor, target));
  assert.deepEqual(roles.map(removable), [[], ["moderator"], ["moderator", "admin"]]);
});

test("the hub opens only to a role it knows, read once where the context comes in", () => {
  for (const role of roles) assert.equal(isRole(role), true, role);
  for (const value of ["member", "Admin", "", null, undefined, 3]) assert.equal(isRole(value), false, String(value));
});
