import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("the privacy policy names the model that writes Highlight portraits in production", async () => {
  const model = (await projectFile("render.yaml")).match(/key: OPENAI_MODEL\s+value: (\S+)/)?.[1];
  assert.ok(model, "render.yaml sets OPENAI_MODEL for the Highlight job");
  assert.ok((await projectFile("src/pages/PrivacyPage.tsx")).includes(model), `the policy names ${model}`);
});

test("the policy's « Supprimer mon compte » is the button members find at the end of their profile editor", async () => {
  const label = "Supprimer mon compte";
  assert.ok((await projectFile("src/pages/PrivacyPage.tsx")).includes(`${label} », en bas de « Modifier mon profil`));
  assert.ok((await projectFile("src/components/profile/DeleteAccount.tsx")).includes(`<h2 id="delete-account-heading">${label}</h2>`));
  assert.ok((await projectFile("src/pages/EditProfilePage.tsx")).includes("<DeleteAccountSection "));
});
