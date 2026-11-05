import assert from "node:assert/strict";
import test from "node:test";
import { mapPublicProfile } from "../../../src/lib/publicProfiles.ts";
import { profileIdFromHref } from "../../../src/lib/profileGate.ts";

test("a link to a member profile gives that member's id", () => {
  assert.equal(profileIdFromHref("/alumni/2f1c"), "2f1c");
  assert.equal(profileIdFromHref("/alumni/2f1c?from=annuaire"), "2f1c");
  assert.equal(profileIdFromHref("/alumni/2f1c#parcours"), "2f1c");
});

test("other links are left alone", () => {
  for (const href of [null, undefined, "", "/annuaire", "/alumni/", "/alumni/2f1c/autre", "https://example.test/alumni/2f1c", "/offres/2f1c"]) {
    assert.equal(profileIdFromHref(href), undefined, String(href));
  }
});

test("a public listing becomes a directory card without any private detail", () => {
  const profile = mapPublicProfile({
    id: "2f1c", first_name: "Awa", last_name: "Traoré", member_role: "alumni", graduation_year: 2019,
    specialty: "Data science", specialties: ["IA"], domain: "Numérique", city: "Paris", country: "France",
    photo_url: null, offers_mentoring: true,
  });
  assert.equal(profile.currentRole, "Data science");
  assert.equal(profile.offersMentoring, true);
  assert.equal(profile.isDemo, false);
  assert.equal(profile.experience, "");
  assert.deepEqual(profile.careerSteps, []);
  assert.equal(profile.linkedinUrl, undefined);
});
