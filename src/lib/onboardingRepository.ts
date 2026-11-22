import { supabase } from "./supabase";
import type { CareerStep } from "./careerSteps";
import type { MemberRole } from "./invitations";
import { completionExtras } from "./profileCompletion";
import { normalizeProfileLink } from "./profileLinks";

export type OnboardingProfile = {
  id: string;
  profile_completed: boolean;
  approval_pending: boolean;
  member_role: MemberRole;
  first_name: string;
  last_name: string;
  photo_url: string | null;
};

export type ProfileCompletion = {
  firstName: string; lastName: string; memberRole: "alumni" | "student";
  graduationYear: number; specialty: string; city: string; country: string;
  experience: string; gender: "male" | "female" | "unspecified";
  offersMentoring: boolean; contactVisible: boolean; termsAccepted: boolean; listedPublicly: boolean;
  linkedinUrl?: string; portfolioUrl?: string;
  careerSteps: CareerStep[];
};

export async function loadOnboardingProfile(userId: string): Promise<OnboardingProfile> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  const { data, error } = await supabase.from("profiles")
    .select("id, profile_completed, approval_pending, member_role, first_name, last_name, photo_url").eq("id", userId).single();
  if (error || !data) throw new Error("Impossible de charger votre profil. Réessayez dans un instant.");
  return data as OnboardingProfile;
}

export async function completeMemberProfile(userId: string, profile: ProfileCompletion): Promise<void> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  const { error } = await supabase.rpc("complete_member_profile", {
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

  // The completion RPC is unchanged; steps and the public directory choice are then
  // saved on the member's own row. A retry is safe: the RPC ignores an already completed profile.
  const extras = completionExtras(profile);
  if (Object.keys(extras).length === 0) return;
  const { error: extrasError } = await supabase.from("profiles").update(extras).eq("id", userId);
  if (extrasError) {
    throw new Error("Votre profil est enregistré, mais pas vos étapes de parcours ni votre choix pour l’annuaire public. Réessayez pour les enregistrer.");
  }
}
