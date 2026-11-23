import { supabase } from "./supabase";
import type { MemberRole } from "./invitations";

export type OnboardingProfile = {
  id: string;
  profile_completed: boolean;
  approval_pending: boolean;
  member_role: MemberRole;
  first_name: string;
  last_name: string;
  photo_url: string | null;
};

export async function loadOnboardingProfile(userId: string): Promise<OnboardingProfile> {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  const { data, error } = await supabase.from("profiles")
    .select("id, profile_completed, approval_pending, member_role, first_name, last_name, photo_url").eq("id", userId).single();
  if (error || !data) throw new Error("Impossible de charger votre profil. Réessayez dans un instant.");
  return data as OnboardingProfile;
}
