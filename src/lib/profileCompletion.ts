import { toCareerStepRows, type CareerStep } from "./careerSteps";
import { normalizeProfileLink } from "./profileLinks";

export type ProfileCompletion = {
  firstName: string; lastName: string; memberRole: "alumni" | "student";
  graduationYear: number; specialty: string; city: string; country: string;
  experience: string; gender: "male" | "female" | "unspecified";
  offersMentoring: boolean; contactVisible: boolean; termsAccepted: boolean; listedPublicly: boolean;
  linkedinUrl?: string; portfolioUrl?: string;
  careerSteps: CareerStep[];
};

type Outcome = { error: unknown };

/** What completing a profile needs from Supabase: the completion RPC, then the member's own row. */
export type CompletionClient = {
  rpc(name: "complete_member_profile", params: Record<string, unknown>): PromiseLike<Outcome>;
  from(table: "profiles"): { update(values: Record<string, unknown>): { eq(column: "id", value: string): PromiseLike<Outcome> } };
};

/**
 * What completing a profile saves on the member's own row once the completion
 * RPC has run, since the RPC takes neither: the career steps, and the choice
 * to appear in the public directory, which only an alumnus can make.
 */
export function completionExtras({ memberRole, careerSteps, listedPublicly }: Pick<ProfileCompletion, "memberRole" | "careerSteps" | "listedPublicly">) {
  return {
    ...(careerSteps.length > 0 ? { career_steps: toCareerStepRows(careerSteps) } : {}),
    ...(memberRole === "alumni" && listedPublicly ? { listed_publicly: true as const } : {}),
  };
}

/**
 * Completes a Google profile. The RPC is unchanged; steps and the public
 * directory choice are then saved on the member's own row. A retry is safe:
 * the RPC ignores an already completed profile.
 */
export async function completeMemberProfile(client: CompletionClient, userId: string, profile: ProfileCompletion): Promise<void> {
  const { error } = await client.rpc("complete_member_profile", {
    p_first_name: profile.firstName.trim(), p_last_name: profile.lastName.trim(),
    p_member_role: profile.memberRole, p_graduation_year: profile.graduationYear,
    p_specialty: profile.specialty.trim(), p_city: profile.city.trim(), p_country: profile.country.trim(),
    p_experience: profile.experience.trim(), p_gender: profile.gender,
    p_offers_mentoring: profile.memberRole === "alumni" && profile.offersMentoring,
    p_contact_visible: profile.contactVisible, p_terms_accepted: profile.termsAccepted,
    p_linkedin_url: normalizeProfileLink(profile.linkedinUrl, "linkedin"),
    p_portfolio_url: normalizeProfileLink(profile.portfolioUrl, "portfolio"),
  });
  if (error) throw new Error("Le profil n’a pas pu être enregistré. Vérifiez les champs et réessayez.");

  const extras = completionExtras(profile);
  if (Object.keys(extras).length === 0) return;
  const { error: extrasError } = await client.from("profiles").update(extras).eq("id", userId);
  if (extrasError) {
    throw new Error("Votre profil est enregistré, mais pas vos étapes de parcours ni votre choix pour l’annuaire public. Réessayez pour les enregistrer.");
  }
}
