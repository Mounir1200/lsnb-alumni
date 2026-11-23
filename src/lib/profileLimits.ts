/**
 * The longest text each profile field accepts. The database refuses more
 * (supabase/migrations/20261123120815_profile_field_rules.sql); the forms stop there.
 */
export const PROFILE_LIMITS = {
  name: 100,
  specialty: 200,
  domain: 200,
  place: 150,
  experience: 5000,
  listItems: 20,
  listItemLength: 120,
} as const;

function fitsList(items: readonly string[]) {
  return items.length <= PROFILE_LIMITS.listItems && items.every((item) => item.length <= PROFILE_LIMITS.listItemLength);
}

/** Why the specialties or the mentoring topics cannot be saved as typed, or null when both fit. */
export function profileListsError(specialties: readonly string[], mentoringTopics: readonly string[]): string | null {
  if (!fitsList(specialties)) {
    return `Indiquez ${PROFILE_LIMITS.listItems} spécialités au plus, de ${PROFILE_LIMITS.listItemLength} caractères chacune.`;
  }
  if (!fitsList(mentoringTopics)) {
    return `Indiquez ${PROFILE_LIMITS.listItems} sujets de mentorat au plus, de ${PROFILE_LIMITS.listItemLength} caractères chacun.`;
  }
  return null;
}
