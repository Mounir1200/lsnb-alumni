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

/** A dated step of a member's path; a null end year means it is still ongoing. */
export type CareerStep = {
  kind: CareerStepKind;
  title: string;
  organization: string;
  location: string;
  startYear: number;
  endYear: number | null;
};

/** Form state: years stay strings while typing; `key` keeps React rows stable. */
export type CareerStepDraft = {
  key: string;
  kind: CareerStepKind;
  title: string;
  organization: string;
  location: string;
  startYear: string;
  endYear: string;
};

type CareerStepRow = {
  kind: CareerStepKind;
  title: string;
  organization?: string;
  location?: string;
  start_year: number;
  end_year: number | null;
};

let draftCount = 0;

export function createCareerStepDraft(kind: CareerStepKind = "education"): CareerStepDraft {
  draftCount += 1;
  return { key: `step-${draftCount}`, kind, title: "", organization: "", location: "", startYear: "", endYear: "" };
}

export function toCareerStepDrafts(steps: CareerStep[]): CareerStepDraft[] {
  return steps.map((step) => ({
    ...createCareerStepDraft(step.kind),
    title: step.title,
    organization: step.organization,
    location: step.location,
    startYear: String(step.startYear),
    endYear: step.endYear === null ? "" : String(step.endYear),
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

function compareSteps(first: CareerStep, second: CareerStep) {
  const firstEnd = first.endYear ?? Number.POSITIVE_INFINITY;
  const secondEnd = second.endYear ?? Number.POSITIVE_INFINITY;
  return first.startYear - second.startYear || firstEnd - secondEnd;
}

/** Validates the form rows, ignoring fully empty ones, and orders them in time. */
export function normalizeCareerSteps(drafts: CareerStepDraft[]): CareerStep[] {
  const filled = drafts.filter((draft) =>
    [draft.title, draft.organization, draft.location, draft.startYear, draft.endYear].some((value) => value.trim()));
  if (filled.length > MAX_CAREER_STEPS) {
    throw new Error(`Ajoutez au maximum ${MAX_CAREER_STEPS} étapes.`);
  }
  return filled.map((draft, index) => {
    const position = index + 1;
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
    const endYear = draft.endYear.trim() ? parseYear(draft.endYear, position, "fin") : null;
    if (endYear !== null && endYear < startYear) {
      throw new Error(`Étape ${position} : l’année de fin précède l’année de début.`);
    }
    return { kind: draft.kind, title, organization, location, startYear, endYear };
  }).sort(compareSteps);
}

export function toCareerStepRows(steps: CareerStep[]): CareerStepRow[] {
  return steps.map((step) => ({
    kind: step.kind,
    title: step.title,
    ...(step.organization ? { organization: step.organization } : {}),
    ...(step.location ? { location: step.location } : {}),
    start_year: step.startYear,
    end_year: step.endYear,
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

/** Reads stored steps defensively: an unexpected entry is skipped, never rendered. */
export function parseCareerSteps(value: unknown): CareerStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStepRow).map((row) => ({
    kind: row.kind,
    title: row.title,
    organization: row.organization ?? "",
    location: row.location ?? "",
    startYear: row.start_year,
    endYear: row.end_year ?? null,
  })).sort(compareSteps);
}

/** The ongoing job, used as the member's current role when there is one. */
export function findCurrentJob(steps: CareerStep[]) {
  return [...steps].reverse().find((step) => step.kind === "work" && step.endYear === null);
}
