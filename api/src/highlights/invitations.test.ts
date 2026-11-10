import assert from "node:assert/strict";
import test from "node:test";
import {
  audienceOf,
  heroActions,
  mentoringInvitation,
  profileInvitation,
  type Audience,
} from "../../../src/lib/invitations.ts";

const members: Audience[] = ["alumni", "student"];

test("a visitor is first invited to join, and can still browse the directory", () => {
  const { primary, secondary } = heroActions("visitor");
  assert.deepEqual(primary, { label: "Créer mon compte", to: "/rejoindre" });
  assert.deepEqual(secondary, { label: "Explorer l’annuaire", to: "/annuaire" });
});

test("an alumnus goes to the directory first, and can offer mentoring from their profile", () => {
  const { primary, secondary } = heroActions("alumni");
  assert.deepEqual(primary, { label: "Explorer l’annuaire", to: "/annuaire" });
  assert.deepEqual(secondary, { label: "Proposer un mentorat", to: "/espace/modifier#mentorat" });
});

test("a pupil goes to the directory first, and can look for a mentor", () => {
  const { primary, secondary } = heroActions("student");
  assert.deepEqual(primary, { label: "Explorer l’annuaire", to: "/annuaire" });
  assert.deepEqual(secondary, { label: "Trouver un mentor", to: "/annuaire?mentor=true" });
});

test("a visitor becomes a mentor through the sign-up form", () => {
  assert.deepEqual(mentoringInvitation("visitor"), { label: "Devenir mentor", to: "/rejoindre?mentorat=true" });
});

test("an alumnus offers mentoring from their profile, and a pupil is not asked to", () => {
  assert.deepEqual(mentoringInvitation("alumni"), { label: "Proposer un mentorat", to: "/espace/modifier#mentorat" });
  assert.equal(mentoringInvitation("student"), null);
});

test("a visitor is invited to create a profile, and a member to update theirs", () => {
  assert.deepEqual(profileInvitation("visitor").action, { label: "Créer mon profil", to: "/rejoindre" });
  for (const member of members) {
    assert.deepEqual(profileInvitation(member).action, { label: "Modifier mon profil", to: "/espace/modifier" });
    assert.notEqual(profileInvitation(member).title, profileInvitation("visitor").title);
  }
});

test("no link shown to a signed-in member leads to the sign-up form", () => {
  for (const member of members) {
    const { primary, secondary } = heroActions(member);
    const links = [primary, secondary, mentoringInvitation(member), profileInvitation(member).action];
    for (const link of links) {
      if (link) assert.ok(!link.to.startsWith("/rejoindre"), `${member}: ${link.label} → ${link.to}`);
    }
  }
});

test("only a session known to be absent makes a visitor; a member is an alumnus until the profile says pupil", () => {
  assert.equal(audienceOf({ isLoading: false, isSignedIn: false, memberRole: null }), "visitor");
  assert.equal(audienceOf({ isLoading: true, isSignedIn: false, memberRole: null }), "alumni");
  assert.equal(audienceOf({ isLoading: false, isSignedIn: true, memberRole: null }), "alumni");
  assert.equal(audienceOf({ isLoading: false, isSignedIn: true, memberRole: "alumni" }), "alumni");
  assert.equal(audienceOf({ isLoading: false, isSignedIn: true, memberRole: "student" }), "student");
});
