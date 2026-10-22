import assert from "node:assert/strict";
import test from "node:test";
import { BOBO_DIOULASSO, findPlace, isNearSchool } from "../../../src/data/places.ts";
import { toStoryBlocks } from "../../../src/lib/profileStory.ts";

// Over the 200-character lede limit on purpose.
const longSentence = "Après deux années de classes préparatoires à Ouagadougou, j’ai intégré une école d’ingénieurs en France où je me suis spécialisé en science des données, avec deux échanges universitaires en Lituanie et en Allemagne.";

test("a short story becomes a lede and keeps the member's paragraphs", () => {
  assert.deepEqual(toStoryBlocks("  Je travaille dans l’énergie solaire.  \n\n\nJ’aide les élèves à choisir leur filière.  "), {
    lede: "Je travaille dans l’énergie solaire.",
    paragraphs: ["J’aide les élèves à choisir leur filière."],
  });
});

test("a long first paragraph opens with its first sentence when that sentence is short", () => {
  const blocks = toStoryBlocks(`Le LSNB m’a appris la rigueur et la persévérance au quotidien. ${longSentence} Aujourd’hui je travaille à Lyon.`);
  assert.equal(blocks.lede, "Le LSNB m’a appris la rigueur et la persévérance au quotidien.");
  assert.deepEqual(blocks.paragraphs, [`${longSentence} Aujourd’hui je travaille à Lyon.`]);
});

test("long opening sentences and abbreviations are never cut into a lede", () => {
  const story = `${longSentence} ${longSentence}`;
  assert.deepEqual(toStoryBlocks(story), { paragraphs: [story] });
  const abbreviation = `J’ai rencontré M. Ouédraogo en terminale. ${longSentence}`;
  assert.equal(toStoryBlocks(abbreviation).lede, undefined);
  assert.deepEqual(toStoryBlocks("   \n  "), { paragraphs: [] });
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
