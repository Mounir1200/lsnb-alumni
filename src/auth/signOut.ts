import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ends the session, then forgets the profile drafts (they may hold personal
 * details on a shared device) and leaves the members' pages.
 */
export async function signOutAndLeave(auth: Pick<SupabaseClient["auth"], "signOut">, clearDrafts: () => void, leave: () => void) {
  await auth.signOut();
  clearDrafts();
  leave();
}
