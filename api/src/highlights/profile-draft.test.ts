import assert from "node:assert/strict";
import test from "node:test";
import { createCareerStepDraft } from "../../../src/lib/careerSteps.ts";
import {
  clearProfileDraft,
  clearProfileDrafts,
  hasSameDraftContent,
  loadProfileDraft,
  resumableDraft,
  saveProfileDraft,
  type EditorForm,
} from "../../../src/lib/profileDraft.ts";

class MemoryStorage {
  readonly items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const blockedStorage = {
  get length(): number { throw new Error("blocked"); },
  key(): string | null { throw new Error("blocked"); },
  getItem(): string | null { throw new Error("blocked"); },
  setItem(): void { throw new Error("blocked"); },
  removeItem(): void { throw new Error("blocked"); },
  clear(): void { throw new Error("blocked"); },
};

function form(changes: Partial<EditorForm> = {}): EditorForm {
  return {
    firstName: "Awa", lastName: "Traoré", memberRole: "alumni", gender: "female", graduationYear: "2019",
    specialty: "Data science", domain: "Numérique", specialties: "IA, statistiques", city: "Paris", country: "France",
    experience: "Mon parcours.", careerSteps: [{ ...createCareerStepDraft("work"), title: "Data scientist", startYear: "2023", ongoing: true }],
    linkedinUrl: "", portfolioUrl: "", offersMentoring: true, mentoringTopics: "Orientation", contactVisible: false, listedPublicly: true,
    ...changes,
  };
}

test("a draft is kept per member and comes back with its content and date", () => {
  const storage = new MemoryStorage();
  const savedAt = new Date("2026-11-05T18:42:00Z");
  saveProfileDraft("member-a", form({ city: "Lyon" }), storage, savedAt);

  const draft = loadProfileDraft("member-a", storage);
  assert.equal(draft?.savedAt.toISOString(), savedAt.toISOString());
  assert.equal(draft?.form.city, "Lyon");
  assert.ok(hasSameDraftContent(draft!.form, form({ city: "Lyon" })));
  assert.equal(loadProfileDraft("member-b", storage), undefined);
});

test("restored career steps get fresh row keys so new rows never collide", () => {
  const storage = new MemoryStorage();
  const original = form();
  saveProfileDraft("member-a", original, storage);
  const restored = loadProfileDraft("member-a", storage)!.form.careerSteps[0]!;
  assert.notEqual(restored.key, original.careerSteps[0]!.key);
  assert.notEqual(restored.key, createCareerStepDraft().key);
  assert.equal(restored.title, "Data scientist");
});

test("only a draft that still differs from the saved profile is resumed", () => {
  const saved = form();
  const changed = { savedAt: new Date("2026-11-05T18:42:00Z"), form: form({ city: "Lyon" }) };
  assert.equal(resumableDraft(changed, saved), changed);
  assert.equal(resumableDraft({ ...changed, form: form() }, saved), undefined);
  assert.equal(resumableDraft(undefined, saved), undefined);
});

test("comparing drafts ignores row keys but not content", () => {
  const first = form();
  const second = form({ careerSteps: first.careerSteps.map((step) => ({ ...step, key: "another-key" })) });
  assert.equal(hasSameDraftContent(first, second), true);
  assert.equal(hasSameDraftContent(first, form({ experience: "Autre parcours." })), false);
});

test("a stored draft that is not a valid form is ignored", () => {
  const storage = new MemoryStorage();
  for (const stored of ["not json", "null", JSON.stringify({ version: 1, savedAt: "2026-11-05T18:42:00Z", form: { ...form(), gender: "other" } }),
    JSON.stringify({ version: 1, savedAt: "yesterday", form: form() }),
    JSON.stringify({ version: 1, savedAt: "2026-11-05T18:42:00Z", form: { ...form(), careerSteps: [{ kind: "hobby" }] } }),
    JSON.stringify({ version: 2, savedAt: "2026-11-05T18:42:00Z", form: form() })]) {
    storage.setItem("lsnb:profile-draft:member-a", stored);
    assert.equal(loadProfileDraft("member-a", storage), undefined, stored.slice(0, 60));
  }
});

test("drafts are cleared for one member, or all at sign-out, leaving other keys alone", () => {
  const storage = new MemoryStorage();
  storage.setItem("theme", "dark");
  saveProfileDraft("member-a", form(), storage);
  saveProfileDraft("member-b", form(), storage);
  clearProfileDraft("member-a", storage);
  assert.equal(loadProfileDraft("member-a", storage), undefined);
  assert.ok(loadProfileDraft("member-b", storage));
  clearProfileDrafts(storage);
  assert.deepEqual([...storage.items.keys()], ["theme"]);
});

test("a blocked or missing storage never breaks the form", () => {
  assert.doesNotThrow(() => saveProfileDraft("member-a", form(), blockedStorage));
  assert.equal(loadProfileDraft("member-a", blockedStorage), undefined);
  assert.doesNotThrow(() => clearProfileDrafts(blockedStorage));
  assert.doesNotThrow(() => saveProfileDraft("member-a", form(), undefined));
  assert.equal(loadProfileDraft("member-a", undefined), undefined);
});

test("comparing drafts does not depend on the order of their fields", () => {
  const reordered = Object.fromEntries(Object.entries(form()).reverse()) as EditorForm;
  assert.equal(hasSameDraftContent(form(), reordered), true);
});
