import assert from "node:assert/strict";
import test from "node:test";
import {
  createCareerStepDraft,
  findCurrentJob,
  isLsnbStep,
  isOngoingStep,
  normalizeCareerSteps,
  parseCareerSteps,
  toCareerStepDrafts,
  toCareerStepRows,
  type CareerStepDraft,
} from "../../../src/lib/careerSteps.ts";

const draft = (changes: Partial<CareerStepDraft>): CareerStepDraft => ({ ...createCareerStepDraft(), ...changes });

test("steps are trimmed, ordered in time and empty form rows are ignored", () => {
  const steps = normalizeCareerSteps([
    draft({ kind: "work", title: "  Développeur IA ", organization: " ESSCA ", startYear: "2024" }),
    draft({}),
    draft({ title: "Classes préparatoires", location: "Ouagadougou", startYear: "2020", endYear: "2022" }),
  ]);
  assert.deepEqual(steps, [
    { kind: "education", title: "Classes préparatoires", organization: "", location: "Ouagadougou", startYear: 2020, endYear: 2022 },
    { kind: "work", title: "Développeur IA", organization: "ESSCA", location: "", startYear: 2024, endYear: null },
  ]);
  assert.deepEqual(toCareerStepRows(steps), [
    { kind: "education", title: "Classes préparatoires", location: "Ouagadougou", start_year: 2020, end_year: 2022 },
    { kind: "work", title: "Développeur IA", organization: "ESSCA", start_year: 2024, end_year: null },
  ]);
});

test("invalid steps are reported by position before any request", () => {
  const cases: [Partial<CareerStepDraft>, RegExp][] = [
    [{ title: "X", startYear: "2020" }, /Étape 1 : indiquez un intitulé/],
    [{ title: "Licence", startYear: "" }, /année de début/],
    [{ title: "Licence", startYear: "20" }, /année de début/],
    [{ title: "Licence", startYear: "2020", endYear: "2019" }, /précède/],
    [{ title: "Licence", startYear: "2020", organization: "x".repeat(121) }, /120 caractères/],
  ];
  for (const [changes, message] of cases) {
    assert.throws(() => normalizeCareerSteps([draft(changes)]), message);
  }
  assert.throws(() => normalizeCareerSteps(Array.from({ length: 13 }, () => draft({ title: "Licence", startYear: "2020" }))), /maximum 12/);
});

test("stored steps are read defensively and round-trip through the form", () => {
  const steps = parseCareerSteps([
    { kind: "work", title: "Data analyst", organization: "Opérateur télécom", start_year: 2022, end_year: 2023 },
    { kind: "hobby", title: "Ignoré", start_year: 2020 },
    "not a step",
    { kind: "education", title: "Diplôme d’ingénieur", start_year: 2020 },
  ]);
  assert.deepEqual(steps.map((step) => step.title), ["Diplôme d’ingénieur", "Data analyst"]);
  assert.equal(steps[0]?.endYear, null);
  assert.deepEqual(normalizeCareerSteps(toCareerStepDrafts(steps)), steps);
  assert.deepEqual(parseCareerSteps(null), []);
});

test("the current job is the latest ongoing work step, open-ended or ending later", () => {
  const steps = parseCareerSteps([
    { kind: "education", title: "Doctorat", start_year: 2023, end_year: null },
    { kind: "work", title: "Ingénieur", organization: "Bureau d’études", start_year: 2020, end_year: null },
    { kind: "work", title: "Stage", start_year: 2019, end_year: 2019 },
  ]);
  assert.equal(findCurrentJob(steps, 2026)?.title, "Ingénieur");
  assert.equal(findCurrentJob(steps.filter((step) => step.kind === "education"), 2026), undefined);
  const contract = parseCareerSteps([{ kind: "work", title: "Alternance", start_year: 2024, end_year: 2027 }]);
  assert.equal(findCurrentJob(contract, 2026)?.title, "Alternance");
  assert.equal(findCurrentJob(contract, 2028), undefined);
});

test("a step is ongoing once started and until its end year", () => {
  const [degree] = parseCareerSteps([{ kind: "education", title: "Diplôme d’ingénieur", start_year: 2022, end_year: 2026 }]);
  assert.equal(isOngoingStep(degree!, 2021), false);
  assert.equal(isOngoingStep(degree!, 2026), true);
  assert.equal(isOngoingStep(degree!, 2027), false);
});

test("a member's own LSNB step is recognised to replace the automatic baccalaureate", () => {
  const steps = parseCareerSteps([
    { kind: "education", title: "Baccalauréat C", organization: "Lycée Scientifique National de Bobo Dioulasso", start_year: 2017, end_year: 2020 },
    { kind: "education", title: "Terminale au LSNB", start_year: 2019, end_year: 2020 },
    { kind: "education", title: "MPSI - MP", organization: "Classes préparatoires - La Salle", start_year: 2020, end_year: 2022 },
    { kind: "work", title: "Professeur", organization: "LSNB", start_year: 2024, end_year: null },
  ]);
  assert.deepEqual(steps.map(isLsnbStep), [true, true, false, false]);
});
