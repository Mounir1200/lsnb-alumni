import { normalizeSearchText } from "./searchText";

export const CAREER_STEP_KINDS = ["education", "work"] as const;
export type CareerStepKind = (typeof CAREER_STEP_KINDS)[number];

// Keep aligned with public.is_valid_career_steps.
export const MAX_CAREER_STEPS = 12;
export const CAREER_STEP_LIMITS = {
  title: { min: 2, max: 120 },
  organization: { max: 120 },
  location: { max: 120 },
  year: { min: 1950, max: 2100 },
} as const;

/** French month abbreviations, January first. */
export const MONTH_LABELS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] as const;

/**
 * A dated step of a member's path. A null end year means it is still ongoing.
 * Months are optional; an end month only exists alongside an end year.
 */
export type CareerStep = {
  kind: CareerStepKind;
  title: string;
  organization: string;
  location: string;
  startYear: number;
  startMonth?: number;
  endYear: number | null;
  endMonth?: number;
};

/** Form state: dates stay strings while typing; `key` keeps React rows stable. */
export type CareerStepDraft = {
  key: string;
  kind: CareerStepKind;
  title: string;
  organization: string;
  location: string;
  startYear: string;
  startMonth: string;
  endYear: string;
  endMonth: string;
  ongoing: boolean;
};

/** A calendar month: ongoing status never needs the day. */
export type YearMonth = { year: number; month: number };

type CareerStepRow = {
  kind: CareerStepKind;
  title: string;
  organization?: string;
  location?: string;
  start_year: number;
  start_month?: number;
  end_year: number | null;
  end_month?: number;
};

let draftCount = 0;

export function createCareerStepDraft(kind: CareerStepKind = "education"): CareerStepDraft {
  draftCount += 1;
  return {
    key: `step-${draftCount}`, kind, title: "", organization: "", location: "",
    startYear: "", startMonth: "", endYear: "", endMonth: "", ongoing: false,
  };
}

const DRAFT_TEXT_FIELDS = ["title", "organization", "location", "startYear", "startMonth", "endYear", "endMonth"] as const;

/** Reads a form row saved outside the page (a draft); it gets a fresh row key. */
export function parseCareerStepDraft(value: unknown): CareerStepDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!CAREER_STEP_KINDS.includes(row.kind as CareerStepKind) || typeof row.ongoing !== "boolean") return undefined;
  if (!DRAFT_TEXT_FIELDS.every((field) => typeof row[field] === "string")) return undefined;
  const draft = createCareerStepDraft(row.kind as CareerStepKind);
  for (const field of DRAFT_TEXT_FIELDS) draft[field] = row[field] as string;
  return { ...draft, ongoing: row.ongoing };
}

const monthText = (month?: number) => (month === undefined ? "" : String(month));

export function toCareerStepDrafts(steps: CareerStep[]): CareerStepDraft[] {
  return steps.map((step) => ({
    ...createCareerStepDraft(step.kind),
    title: step.title,
    organization: step.organization,
    location: step.location,
    startYear: String(step.startYear),
    startMonth: monthText(step.startMonth),
    endYear: step.endYear === null ? "" : String(step.endYear),
    endMonth: monthText(step.endMonth),
    ongoing: step.endYear === null,
  }));
}

function characterCount(value: string) {
  return [...value].length;
}

function parseYear(value: string, position: number, label: string) {
  const { min, max } = CAREER_STEP_LIMITS.year;
  const year = Number(value.trim());
  if (!/^\d{4}$/.test(value.trim()) || year < min || year > max) {
    throw new Error(`Étape ${position} : l’année de ${label} doit être comprise entre ${min} et ${max}.`);
  }
  return year;
}

function parseMonth(value: string, position: number, label: string) {
  if (!value.trim()) return undefined;
  const month = Number(value.trim());
  if (!/^\d{1,2}$/.test(value.trim()) || month < 1 || month > MONTH_LABELS.length) {
    throw new Error(`Étape ${position} : le mois de ${label} doit être compris entre 1 et 12.`);
  }
  return month;
}

/** Orders dates by month; a missing month counts as January, so a year-only date sorts first. */
function monthIndex(year: number, month?: number) {
  return year * MONTH_LABELS.length + (month ?? 1);
}

function endIndex(step: CareerStep) {
  return step.endYear === null ? Number.POSITIVE_INFINITY : monthIndex(step.endYear, step.endMonth);
}

function compareSteps(first: CareerStep, second: CareerStep) {
  return monthIndex(first.startYear, first.startMonth) - monthIndex(second.startYear, second.startMonth)
    || endIndex(first) - endIndex(second);
}

/**
 * A missing end month counts as December and a missing start month as January, so
 * months only decide within one year. Keep aligned with public.is_valid_career_steps.
 */
function endsBeforeStart({ startYear, startMonth, endYear, endMonth }: CareerStep) {
  return endYear !== null && monthIndex(endYear, endMonth ?? MONTH_LABELS.length) < monthIndex(startYear, startMonth);
}

/** Adds only the months that are known: an absent month has no key at all. */
function withMonths(step: CareerStep, startMonth?: number, endMonth?: number): CareerStep {
  return {
    ...step,
    ...(startMonth === undefined ? {} : { startMonth }),
    ...(endMonth === undefined ? {} : { endMonth }),
  };
}

function isFilled(draft: CareerStepDraft) {
  return [draft.title, draft.organization, draft.location, draft.startYear, draft.startMonth, draft.endYear, draft.endMonth]
    .some((value) => value.trim());
}

function parseEnd(draft: CareerStepDraft, position: number) {
  if (draft.ongoing) return { endYear: null, endMonth: undefined };
  if (!draft.endYear.trim()) {
    throw new Error(`Étape ${position} : indiquez l’année de fin ou cochez « En cours ».`);
  }
  return { endYear: parseYear(draft.endYear, position, "fin"), endMonth: parseMonth(draft.endMonth, position, "fin") };
}

function normalizeStep(draft: CareerStepDraft, position: number): CareerStep {
  const title = draft.title.trim();
  const organization = draft.organization.trim();
  const location = draft.location.trim();
  if (characterCount(title) < CAREER_STEP_LIMITS.title.min || characterCount(title) > CAREER_STEP_LIMITS.title.max) {
    throw new Error(`Étape ${position} : indiquez un intitulé de ${CAREER_STEP_LIMITS.title.min} à ${CAREER_STEP_LIMITS.title.max} caractères.`);
  }
  if (characterCount(organization) > CAREER_STEP_LIMITS.organization.max || characterCount(location) > CAREER_STEP_LIMITS.location.max) {
    throw new Error(`Étape ${position} : l’établissement et le lieu font au maximum 120 caractères.`);
  }
  const startYear = parseYear(draft.startYear, position, "début");
  const startMonth = parseMonth(draft.startMonth, position, "début");
  const { endYear, endMonth } = parseEnd(draft, position);
  const step = withMonths({ kind: draft.kind, title, organization, location, startYear, endYear }, startMonth, endMonth);
  if (endsBeforeStart(step)) {
    throw new Error(`Étape ${position} : la date de fin précède la date de début.`);
  }
  return step;
}

/** Validates the form rows, ignoring fully empty ones, and orders them in time. */
export function normalizeCareerSteps(drafts: CareerStepDraft[]): CareerStep[] {
  const filled = drafts.filter(isFilled);
  if (filled.length > MAX_CAREER_STEPS) {
    throw new Error(`Ajoutez au maximum ${MAX_CAREER_STEPS} étapes.`);
  }
  return filled.map((draft, index) => normalizeStep(draft, index + 1)).sort(compareSteps);
}

export function toCareerStepRows(steps: CareerStep[]): CareerStepRow[] {
  return steps.map((step) => ({
    kind: step.kind,
    title: step.title,
    ...(step.organization ? { organization: step.organization } : {}),
    ...(step.location ? { location: step.location } : {}),
    start_year: step.startYear,
    ...(step.startMonth === undefined ? {} : { start_month: step.startMonth }),
    end_year: step.endYear,
    ...(step.endMonth === undefined ? {} : { end_month: step.endMonth }),
  }));
}

function isStepRow(value: unknown): value is CareerStepRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CareerStepRow>;
  return CAREER_STEP_KINDS.includes(row.kind as CareerStepKind)
    && typeof row.title === "string"
    && Number.isInteger(row.start_year)
    && (row.end_year === null || row.end_year === undefined || Number.isInteger(row.end_year));
}

function storedMonth(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MONTH_LABELS.length
    ? value as number
    : undefined;
}

function fromRow(row: CareerStepRow): CareerStep {
  const endYear = row.end_year ?? null;
  return withMonths(
    { kind: row.kind, title: row.title, organization: row.organization ?? "", location: row.location ?? "", startYear: row.start_year, endYear },
    storedMonth(row.start_month),
    endYear === null ? undefined : storedMonth(row.end_month),
  );
}

/** Reads stored steps defensively: an unexpected entry is skipped, an invalid month dropped. */
export function parseCareerSteps(value: unknown): CareerStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStepRow).map(fromRow).sort(compareSteps);
}

export function currentYearMonth(date = new Date()): YearMonth {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/**
 * Ongoing: started, and either open-ended or ending this month or later.
 * Without an end month, a step ending this year has ended: only an open end
 * means "still there", so finished paths no longer read as current.
 */
export function isOngoingStep(step: CareerStep, today: YearMonth = currentYearMonth()) {
  const now = monthIndex(today.year, today.month);
  if (monthIndex(step.startYear, step.startMonth) > now) return false;
  if (step.endYear === null) return true;
  return step.endMonth === undefined ? step.endYear > today.year : monthIndex(step.endYear, step.endMonth) >= now;
}

/** The ongoing job, used as the member's current role when there is one. */
export function findCurrentJob(steps: CareerStep[], today: YearMonth = currentYearMonth()) {
  return [...steps].reverse().find((step) => step.kind === "work" && isOngoingStep(step, today));
}

function formatDate(year: number, month?: number) {
  return month === undefined ? String(year) : `${MONTH_LABELS[month - 1]} ${year}`;
}

/** "sept. 2022 – juin 2024", "Depuis oct. 2024", or a single date for a one-off step. */
export function formatCareerPeriod(step: CareerStep) {
  const start = formatDate(step.startYear, step.startMonth);
  if (step.endYear === null) return `Depuis ${start}`;
  const end = formatDate(step.endYear, step.endMonth);
  return start === end ? start : `${start} – ${end}`;
}

const LSNB_PATTERN = /\b(lsnb|lycee scientifique national)\b/;

/** Members may enter their own LSNB years; that step then replaces the automatic baccalaureate entry. */
export function isLsnbStep(step: CareerStep) {
  return step.kind === "education" && LSNB_PATTERN.test(normalizeSearchText(`${step.title} ${step.organization}`));
}
