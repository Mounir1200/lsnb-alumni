import assert from "node:assert/strict";
import test from "node:test";
import { heroActions } from "../../../src/lib/heroActions.ts";

test("a visitor is first invited to join, and can still browse the directory", () => {
  const { primary, secondary } = heroActions({ isVisitor: true });
  assert.deepEqual(primary, { label: "Créer mon compte", to: "/rejoindre" });
  assert.deepEqual(secondary, { label: "Explorer l’annuaire", to: "/annuaire" });
});

test("a member goes to the directory first, and can offer mentoring", () => {
  const { primary, secondary } = heroActions({ isVisitor: false });
  assert.deepEqual(primary, { label: "Explorer l’annuaire", to: "/annuaire" });
  assert.deepEqual(secondary, { label: "Proposer un mentorat", to: "/rejoindre?mentorat=true" });
});
