import { parseCareerStepDraft, type CareerStepDraft } from "./careerSteps";
import type { ProfileGender } from "./profileRepository";

/** The profile editor's form, kept as typed so it can be restored as a draft. */
export type EditorForm = {
  firstName: string;
  lastName: string;
  memberRole: "alumni" | "student";
  gender: ProfileGender;
  graduationYear: string;
  specialty: string;
  domain: string;
  specialties: string;
  city: string;
  country: string;
  experience: string;
  careerSteps: CareerStepDraft[];
  linkedinUrl: string;
  portfolioUrl: string;
  offersMentoring: boolean;
  mentoringTopics: string;
  contactVisible: boolean;
};

export type ProfileDraft = { savedAt: Date; form: EditorForm };

/** Bump when EditorForm changes shape: older drafts are then ignored. */
const DRAFT_VERSION = 1;
const KEY_PREFIX = "lsnb:profile-draft:";
const TEXT_FIELDS = [
  "firstName", "lastName", "graduationYear", "specialty", "domain", "specialties", "city", "country",
  "experience", "linkedinUrl", "portfolioUrl", "mentoringTopics",
] as const;
const ROLES: EditorForm["memberRole"][] = ["alumni", "student"];
const GENDERS: ProfileGender[] = ["male", "female", "unspecified"];

type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

/** Private browsing or blocked site data can make localStorage throw on access. */
function browserStorage(): DraftStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Drafts are a convenience: a storage failure must never break the form. */
function attempt<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch {
    return undefined;
  }
}

function parseForm(value: unknown): EditorForm | undefined {
  if (!value || typeof value !== "object") return undefined;
  const form = value as Record<string, unknown>;
  if (!TEXT_FIELDS.every((field) => typeof form[field] === "string")) return undefined;
  if (!ROLES.includes(form.memberRole as EditorForm["memberRole"]) || !GENDERS.includes(form.gender as ProfileGender)) return undefined;
  if (typeof form.offersMentoring !== "boolean" || typeof form.contactVisible !== "boolean" || !Array.isArray(form.careerSteps)) return undefined;
  const careerSteps = form.careerSteps.map(parseCareerStepDraft);
  if (careerSteps.some((step) => step === undefined)) return undefined;
  return { ...(form as EditorForm), careerSteps: careerSteps as CareerStepDraft[] };
}

function parseDraft(stored: string): ProfileDraft | undefined {
  const value = JSON.parse(stored) as { version?: unknown; savedAt?: unknown; form?: unknown } | null;
  if (value?.version !== DRAFT_VERSION || typeof value.savedAt !== "string") return undefined;
  const savedAt = new Date(value.savedAt);
  const form = parseForm(value.form);
  return Number.isNaN(savedAt.getTime()) || !form ? undefined : { savedAt, form };
}

export function saveProfileDraft(userId: string, form: EditorForm, storage = browserStorage(), savedAt = new Date()) {
  attempt(() => storage?.setItem(KEY_PREFIX + userId, JSON.stringify({ version: DRAFT_VERSION, savedAt: savedAt.toISOString(), form })));
}

export function loadProfileDraft(userId: string, storage = browserStorage()): ProfileDraft | undefined {
  return attempt(() => {
    const stored = storage?.getItem(KEY_PREFIX + userId);
    return stored ? parseDraft(stored) : undefined;
  });
}

export function clearProfileDraft(userId: string, storage = browserStorage()) {
  attempt(() => storage?.removeItem(KEY_PREFIX + userId));
}

/** At sign-out: nothing typed in the editor stays on a shared device. */
export function clearProfileDrafts(storage = browserStorage()) {
  attempt(() => {
    if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    keys.filter((key) => key?.startsWith(KEY_PREFIX)).forEach((key) => storage.removeItem(key!));
  });
}

/** Row keys only keep React rows stable; they are not part of what the member typed. */
function withoutRowKeys(form: EditorForm) {
  return { ...form, careerSteps: form.careerSteps.map(({ key: _key, ...step }) => step) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function hasSameDraftContent(first: EditorForm, second: EditorForm) {
  return JSON.stringify(canonical(withoutRowKeys(first))) === JSON.stringify(canonical(withoutRowKeys(second)));
}
