import assert from "node:assert/strict";
import test from "node:test";
import { reportErrorMessage } from "../../../src/hub/reportErrors.ts";

test("each error of the hub's report functions has the team's wording", () => {
  const cases: [string, RegExp][] = [
    ["This report was already settled", /déjà été traité/],
    ["Forbidden: report outside your scope", /votre promotion/],
    ["Forbidden: a report you filed yourself goes to another team member", /auteur de ce signalement/],
    ["Report not found", /n’existe plus/],
    ["Explain the outcome in 10 to 500 characters", /10 à 500/],
  ];
  for (const [message, expected] of cases) assert.match(reportErrorMessage(message) ?? "", expected, message);
});

test("errors from other hub functions keep their own wording", () => {
  for (const message of ["You cannot moderate yourself", "Member not found", "Forbidden: staff access required"]) {
    assert.equal(reportErrorMessage(message), null, message);
  }
});
