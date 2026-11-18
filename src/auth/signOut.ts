import type { SupabaseClient } from "@supabase/supabase-js";

type SessionAuth = Pick<SupabaseClient["auth"], "signOut" | "getSession">;

/**
 * Ends the session, then forgets the profile drafts (they may hold personal
 * details on a shared device) and leaves the members' pages. When this browser
 * still holds the session afterwards, for instance while the network is down,
 * it resolves false and leaves everything in place: the member must not
 * believe they signed out.
 */
export async function signOutAndLeave(auth: SessionAuth, clearDrafts: () => void, leave: () => void) {
  if (!await hasLeftThisBrowser(auth)) return false;
  clearDrafts();
  leave();
  return true;
}

/**
 * supabase-js reports an error in two different cases. With a valid token it
 * forgets the session here even when the server cannot be reached, which is
 * what a shared device needs. With an expired token it first refreshes it, and
 * a failed refresh stops the sign-out with the session still stored here; that
 * stored session then answers getSession with the same refresh error.
 */
async function hasLeftThisBrowser(auth: SessionAuth) {
  const { error } = await auth.signOut().catch((cause: unknown) => ({ error: cause }));
  if (!error) return true;
  const { data, error: sessionError } = await auth.getSession()
    .catch((cause: unknown) => ({ data: { session: null }, error: cause }));
  return !sessionError && !data.session;
}
