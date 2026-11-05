import assert from "node:assert/strict";
import test from "node:test";
import {
  createCareerStepDraft,
  currentYearMonth,
  findCurrentJob,
  formatCareerPeriod,
  parseCareerStepDraft,
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
    draft({ kind: "work", title: "  Développeur IA ", organization: " ESSCA ", startYear: "2024", ongoing: true }),
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
  assert.equal(findCurrentJob(steps, { year: 2026, month: 11 })?.title, "Ingénieur");
  assert.equal(findCurrentJob(steps.filter((step) => step.kind === "education"), { year: 2026, month: 11 }), undefined);
  const contract = parseCareerSteps([{ kind: "work", title: "Alternance", start_year: 2024, end_year: 2027 }]);
  assert.equal(findCurrentJob(contract, { year: 2026, month: 11 })?.title, "Alternance");
  assert.equal(findCurrentJob(contract, { year: 2028, month: 1 }), undefined);
});

test("a step is ongoing from its first month until the end of its last month", () => {
  const [degree] = parseCareerSteps([{ kind: "education", title: "Diplôme", start_year: 2022, start_month: 9, end_year: 2026, end_month: 6 }]);
  assert.equal(isOngoingStep(degree!, { year: 2022, month: 8 }), false);
  assert.equal(isOngoingStep(degree!, { year: 2022, month: 9 }), true);
  assert.equal(isOngoingStep(degree!, { year: 2026, month: 6 }), true);
  assert.equal(isOngoingStep(degree!, { year: 2026, month: 7 }), false);
});

test("a step that ended this year without a month is finished, not ongoing", () => {
  const [degree] = parseCareerSteps([{ kind: "education", title: "Diplôme d’ingénieur", start_year: 2022, end_year: 2026 }]);
  assert.equal(isOngoingStep(degree!, { year: 2021, month: 12 }), false);
  assert.equal(isOngoingStep(degree!, { year: 2025, month: 11 }), true);
  assert.equal(isOngoingStep(degree!, { year: 2026, month: 11 }), false);
});

test("months are optional, an ongoing step has no end and a finished one needs its end year", () => {
  const steps = normalizeCareerSteps([
    draft({ kind: "work", title: "Ingénieure", startYear: "2024", startMonth: "10", ongoing: true, endYear: "2025", endMonth: "2" }),
    draft({ title: "Master", startYear: "2022", startMonth: "9", endYear: "2024", endMonth: "6" }),
  ]);
  assert.deepEqual(steps, [
    { kind: "education", title: "Master", organization: "", location: "", startYear: 2022, startMonth: 9, endYear: 2024, endMonth: 6 },
    { kind: "work", title: "Ingénieure", organization: "", location: "", startYear: 2024, startMonth: 10, endYear: null },
  ]);
  assert.deepEqual(toCareerStepRows(steps), [
    { kind: "education", title: "Master", start_year: 2022, start_month: 9, end_year: 2024, end_month: 6 },
    { kind: "work", title: "Ingénieure", start_year: 2024, start_month: 10, end_year: null },
  ]);
  assert.deepEqual(normalizeCareerSteps(toCareerStepDrafts(steps)), steps);
  const invalid: [Partial<CareerStepDraft>, RegExp][] = [
    [{ title: "Licence", startYear: "2020" }, /Étape 1 : indiquez l’année de fin ou cochez « En cours »/],
    [{ title: "Licence", startYear: "2022", startMonth: "9", endYear: "2022", endMonth: "6" }, /précède/],
    [{ title: "Licence", startYear: "2022", startMonth: "13", ongoing: true }, /Étape 1 : le mois de début/],
    [{ title: "Licence", startYear: "2022", endYear: "2023", endMonth: "0" }, /Étape 1 : le mois de fin/],
  ];
  for (const [changes, message] of invalid) {
    assert.throws(() => normalizeCareerSteps([draft(changes)]), message);
  }
});

test("stored months are kept when valid and dropped otherwise", () => {
  const steps = parseCareerSteps([
    { kind: "work", title: "Stage", start_year: 2023, start_month: 2, end_year: 2023, end_month: 7 },
    { kind: "work", title: "Mission", start_year: 2024, start_month: 13, end_year: null, end_month: 3 },
  ]);
  assert.deepEqual(steps.map(({ startMonth, endMonth }) => [startMonth, endMonth]), [[2, 7], [undefined, undefined]]);
  assert.equal("startMonth" in steps[1]!, false);
});

test("periods read with French month abbreviations when months are known", () => {
  const base = { kind: "education" as const, title: "Master", organization: "", location: "" };
  assert.equal(formatCareerPeriod({ ...base, startYear: 2022, startMonth: 9, endYear: 2024, endMonth: 6 }), "sept. 2022 – juin 2024");
  assert.equal(formatCareerPeriod({ ...base, startYear: 2024, startMonth: 10, endYear: null }), "Depuis oct. 2024");
  assert.equal(formatCareerPeriod({ ...base, startYear: 2024, endYear: null }), "Depuis 2024");
  assert.equal(formatCareerPeriod({ ...base, startYear: 2024, endYear: 2024 }), "2024");
  assert.equal(formatCareerPeriod({ ...base, startYear: 2020, endYear: 2023 }), "2020 – 2023");
  assert.equal(formatCareerPeriod({ ...base, startYear: 2024, startMonth: 3, endYear: 2024, endMonth: 3 }), "mars 2024");
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

test("dates are accepted up to their exact limits and refused just beyond", () => {
  const accepts = (changes: Partial<CareerStepDraft>) => assert.doesNotThrow(() => normalizeCareerSteps([draft({ title: "Licence", ongoing: true, ...changes })]));
  const refuses = (changes: Partial<CareerStepDraft>, message: RegExp) => assert.throws(() => normalizeCareerSteps([draft({ title: "Licence", ongoing: true, ...changes })]), message);
  accepts({ startYear: "1950" });
  accepts({ startYear: "2100" });
  refuses({ startYear: "1900" }, /année de début/);
  refuses({ startYear: "2101" }, /année de début/);
  accepts({ startYear: "2020", startMonth: "1" });
  accepts({ startYear: "2020", startMonth: "12" });
});

test("within one year, months decide whether a step ends before it starts", () => {
  const step = (changes: Partial<CareerStepDraft>) => draft({ title: "Stage", startYear: "2024", endYear: "2024", ...changes });
  assert.doesNotThrow(() => normalizeCareerSteps([step({ startMonth: "9" })]));
  assert.doesNotThrow(() => normalizeCareerSteps([step({ endMonth: "3" })]));
  assert.doesNotThrow(() => normalizeCareerSteps([step({ startMonth: "3", endMonth: "3" })]));
  assert.throws(() => normalizeCareerSteps([step({ startMonth: "4", endMonth: "3" })]), /précède/);
});

test("texts are accepted up to their exact length limits", () => {
  assert.doesNotThrow(() => normalizeCareerSteps([draft({ title: "BA", startYear: "2020", ongoing: true })]));
  assert.doesNotThrow(() => normalizeCareerSteps([draft({ title: "x".repeat(120), organization: "o".repeat(120), location: "l".repeat(120), startYear: "2020", ongoing: true })]));
  assert.throws(() => normalizeCareerSteps([draft({ title: "x".repeat(121), startYear: "2020", ongoing: true })]), /intitulé/);
  assert.throws(() => normalizeCareerSteps([draft({ title: "Licence", location: "l".repeat(121), startYear: "2020", ongoing: true })]), /120 caractères/);
  assert.equal(normalizeCareerSteps(Array.from({ length: 12 }, () => draft({ title: "Licence", startYear: "2020", ongoing: true }))).length, 12);
});

test("steps starting together are ordered by their end, the ongoing one last", () => {
  const rows = [
    { kind: "work", title: "En cours", start_year: 2020, end_year: null },
    { kind: "work", title: "Long", start_year: 2020, end_year: 2023 },
    { kind: "work", title: "Court", start_year: 2020, end_year: 2021 },
  ];
  assert.deepEqual(parseCareerSteps(rows).map((step) => step.title), ["Court", "Long", "En cours"]);
  assert.deepEqual(parseCareerSteps([...rows].reverse()).map((step) => step.title), ["Court", "Long", "En cours"]);
});

test("stored rows that are not objects, and months outside 1 to 12, are dropped", () => {
  assert.deepEqual(parseCareerSteps([null, 42, { kind: "work", title: "Stage", start_year: 2020, start_month: 1, end_year: 2020, end_month: 12 }])
    .map(({ startMonth, endMonth }) => [startMonth, endMonth]), [[1, 12]]);
  assert.equal(parseCareerSteps([{ kind: "work", title: "Stage", start_year: 2020, start_month: 0 }])[0]?.startMonth, undefined);
});

test("a saved form row is restored only when it has the expected shape", () => {
  const row = { kind: "work", title: "Stage", organization: "", location: "", startYear: "2020", startMonth: "", endYear: "", endMonth: "", ongoing: true };
  assert.equal(parseCareerStepDraft(row)?.title, "Stage");
  assert.equal(parseCareerStepDraft(null), undefined);
  assert.equal(parseCareerStepDraft({ ...row, ongoing: "yes" }), undefined);
  assert.equal(parseCareerStepDraft({ ...row, kind: "hobby" }), undefined);
  assert.equal(parseCareerStepDraft({ ...row, title: 3 }), undefined);
});

test("today is read at month precision, January being month 1", () => {
  assert.deepEqual(currentYearMonth(new Date(2026, 10, 5)), { year: 2026, month: 11 });
  assert.deepEqual(currentYearMonth(new Date(2027, 0, 31)), { year: 2027, month: 1 });
});
