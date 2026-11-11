import { useAuth } from "../auth/AuthProvider";
import { offerAccessOf, type OfferAccess } from "../lib/memberStatus";
import { isSupabaseConfigured } from "../lib/supabase";

export type { OfferAccess };

export function useOfferAccess(): OfferAccess {
  const { user, isLoading, memberStatus, profileError } = useAuth();
  return offerAccessOf({
    isConfigured: isSupabaseConfigured, isLoading, isSignedIn: Boolean(user), profileError: Boolean(profileError), status: memberStatus,
  });
}
