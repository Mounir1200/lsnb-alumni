import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { BOBO_DIOULASSO, findPlace, isNearSchool } from "../../../src/data/places.ts";
import { toStoryBlocks } from "../../../src/lib/profileStory.ts";

test("the opening paragraph keeps the same size as the rest of the story", () => {
  assert.deepEqual(toStoryBlocks("  Je travaille dans l’énergie solaire.  \n\n\nJ’aide les élèves à choisir leur filière.  "), {
    paragraphs: ["Je travaille dans l’énergie solaire.", "J’aide les élèves à choisir leur filière."],
  });
});

test("paragraph splitting preserves CRLF, Unicode boundary whitespace and interior spaces", () => {
  assert.deepEqual(toStoryBlocks("\xa0Bonjour. \r\n\t\r\n Deux   mots.\xa0\n"), {
    paragraphs: ["Bonjour.", "Deux   mots."],
  });
  assert.deepEqual(toStoryBlocks("   \n  "), { paragraphs: [] });
});

test("long interior whitespace without a newline cannot stall the parser", () => {
  const moduleUrl = new URL("../../../src/lib/profileStory.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { toStoryBlocks } from ${JSON.stringify(moduleUrl)}; const text = 'A' + ' '.repeat(200000) + 'B'; if(toStoryBlocks(text).paragraphs[0] !== text) process.exit(1);`],
    { timeout: 5000, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("places are found by city first, then country, ignoring accents, case and hyphens", () => {
  assert.deepEqual(findPlace("  montreal ", "Canada")?.precision, "city");
  assert.deepEqual(findPlace("Ville non renseignée", "Côte d’Ivoire")?.coordinates, { latitude: 5.36, longitude: -4.01 });
  assert.equal(findPlace("bobo dioulasso", "")?.precision, "city");
  assert.equal(findPlace("Atlantis", "Pays non renseigné"), undefined);
});

test("members around Bobo-Dioulasso have no journey, others do", () => {
  assert.equal(isNearSchool(BOBO_DIOULASSO), true);
  assert.equal(isNearSchool(findPlace("Ouagadougou", "Burkina Faso")!.coordinates), false);
  assert.equal(isNearSchool(findPlace("Banfora", "Burkina Faso")!.coordinates), true);
});
