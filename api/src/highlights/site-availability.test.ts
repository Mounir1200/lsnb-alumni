import assert from "node:assert/strict";
import test from "node:test";
import { activityRoute, parseSiteStatus, remainingTime } from "../../../src/lib/siteAvailability.ts";

test("maintenance countdown clamps at zero and handles days and rounding", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  assert.deepEqual(remainingTime("2026-10-23T13:02:03Z", now), { days: 1, hours: 1, minutes: 2, seconds: 3, total: 90123 });
  assert.equal(remainingTime("2026-10-22T11:59:59Z", now).total, 0);
  assert.equal(remainingTime("2026-10-22T12:00:00.100Z", now).seconds, 1);
});
test("public status requires a valid authoritative payload, without assuming service is open", () => {
  const valid = { enabled: true, active: false, message: "Retour", ends_at: null, started_at: null, server_time: "2026-10-22T12:00:00Z" };
  assert.deepEqual(parseSiteStatus(valid), valid);
  for (const invalid of [null, {}, { ...valid, active: "false" }, { ...valid, ends_at: "bad" }, { ...valid, server_time: null }]) {
    assert.throws(() => parseSiteStatus(invalid));
  }
});
test("usage data contains only coarse route categories, never identifiers", () => {
  assert.equal(activityRoute("/alumni/private-user-id"), "profile");
  assert.equal(activityRoute("/offres/private-offer-id"), "offers");
  assert.equal(activityRoute("/auth/callback"), null);
  assert.equal(activityRoute("/connexion"), null);
  assert.equal(activityRoute("/espace/modifier"), "member");
});
