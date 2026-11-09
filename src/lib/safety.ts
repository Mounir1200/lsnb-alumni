/** How many of a conversation's latest messages a report hands to the moderators (see the report migration). */
export const REPORTED_MESSAGE_COUNT = 20;

/** The error code the database raises when one member of a pair has blocked the other. */
export const BLOCKED_PAIR = "LS423";

/** The error code the database raises when a member tries to block or report themselves. */
export const SELF_TARGETED = "LS422";

/** The reasons the report migration accepts, most frequent first, worded for members. */
export const REPORT_REASONS = [
  { value: "harassment", label: "Harcèlement, insultes ou menaces" },
  { value: "minor_safety", label: "Comportement inquiétant envers un élève" },
  { value: "inappropriate", label: "Contenu choquant ou à caractère sexuel" },
  { value: "scam", label: "Arnaque, demande d’argent ou de documents" },
  { value: "fake_profile", label: "Faux profil ou usurpation d’identité" },
  { value: "other", label: "Autre problème" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

const DETAILS_MAX_LENGTH = 1000;
const OTHER_DETAILS_MIN_LENGTH = 10;

/** The checks the database repeats, run first so that the member sees them at once. */
export function reportProblem(reason: ReportReason | "", details: string): string | null {
  const length = [...details.trim()].length;
  if (!reason) return "Choisissez un motif.";
  if (length > DETAILS_MAX_LENGTH) return "Décrivez le problème en 1 000 caractères au plus.";
  if (reason === "other" && length < OTHER_DETAILS_MIN_LENGTH) {
    return "Pour « Autre problème », décrivez ce qui se passe en 10 caractères au moins.";
  }
  return null;
}
