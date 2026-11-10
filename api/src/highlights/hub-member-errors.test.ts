import assert from "node:assert/strict";
import test from "node:test";
import { memberErrorMessage } from "../../../src/hub/memberErrors.ts";

test("each error of the hub's member and team functions has the team's wording", () => {
  const cases: [string, RegExp][] = [
    ["Remove the staff role before moderating this member", /Retirez d’abord le rôle de ce membre/],
    ["Remove the moderator role before correcting their promotion", /rôle de modérateur avant de corriger/],
    ["You cannot moderate yourself", /vos propres droits/],
    ["You cannot change your own staff role", /vos propres droits/],
    ["Administrator roles are managed in the database", /directement dans la base de données/],
    ["Moderators must belong to their assigned promotion", /appartenir à la promotion/],
    ["Staff must have an active completed profile", /profil complet/],
    ["Member not found", /n’existe plus/],
  ];
  for (const [message, expected] of cases) assert.match(memberErrorMessage(message) ?? "", expected, message);
});

test("errors from other hub functions keep their own wording", () => {
  for (const message of ["Report not found", "Forbidden: staff access required", "Maintenance needs a message between 5 and 500 characters"]) {
    assert.equal(memberErrorMessage(message), null, message);
  }
});
