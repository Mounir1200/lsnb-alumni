import { useAuth } from "../auth/AuthProvider";
import { isSupabaseConfigured } from "../lib/supabase";

export type OfferAccess = "demo" | "checking" | "members-only" | "incomplete" | "profile-error" | "member";

// Offers point to real opportunities, so signed-out visitors of a configured
// site get a sign-in invitation rather than the fictional showcase.
export function useOfferAccess(): OfferAccess {
  const { user, isLoading, profileCompleted, profileError } = useAuth();
  if (!isSupabaseConfigured) return "demo";
  if (isLoading) return "checking";
  if (!user) return "members-only";
  if (profileError) return "profile-error";
  if (profileCompleted === null) return "checking";
  return profileCompleted ? "member" : "incomplete";
}
