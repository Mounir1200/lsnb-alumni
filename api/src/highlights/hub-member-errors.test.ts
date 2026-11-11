import assert from "node:assert/strict";
import test from "node:test";
import { memberErrorMessage } from "../../../src/hub/memberErrors.ts";

test("each error of the hub's member and team functions has the team's wording", () => {
  const cases: [string, RegExp][] = [
    ["Remove the staff role before moderating this member", /Retirez d’abord le rôle de ce membre/],
    ["Remove the moderator role before correcting their promotion", /rôle de modérateur avant de corriger/],
    ["You cannot moderate yourself", /vos propres droits/],
    ["You cannot change your own staff role", /vos propres droits/],
    ["There can be at most 3 super administrators", /déjà trois super administrateurs/],
    ["A super administrator leaves the team by resigning or through the database", /quitte l’équipe lui-même/],
    ["Forbidden: you may only manage roles below your own", /en dessous du vôtre/],
    ["Administrators work network-wide, without a promotion", /tout le réseau/],
    ["The last super administrator cannot leave the team", /dernier super administrateur/],
    ["Moderators must belong to their assigned promotion", /appartenir à la promotion/],
    ["Staff must have an active completed profile", /profil complet/],
    ["Member not found", /n’existe plus/],
    ["Member is not awaiting approval", /n’attend plus de validation/],
    ["Forbidden: moderators may only approve their own promotion", /comptes de votre promotion/],
  ];
  for (const [message, expected] of cases) assert.match(memberErrorMessage(message) ?? "", expected, message);
});

test("errors from other hub functions keep their own wording", () => {
  for (const message of ["Report not found", "Forbidden: staff access required", "Maintenance needs a message between 5 and 500 characters",
    "Administrator roles are managed in the database"]) {
    assert.equal(memberErrorMessage(message), null, message);
  }
});
