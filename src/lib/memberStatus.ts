export type MemberStatus = "incomplete" | "pending" | "active";

type AccountFlags = { profile_completed: boolean; approval_pending: boolean };

/** An account first completes its profile, then waits for its promotion's approval, then is an active member. */
export function memberStatusOf({ profile_completed, approval_pending }: AccountFlags): MemberStatus {
  if (!profile_completed) return "incomplete";
  return approval_pending ? "pending" : "active";
}

export type ProfileGateKind = "join" | "complete" | "wait";

/**
 * What a reader who is not an active member needs before profiles open to
 * them. A signed-in reader whose status is still loading is told to wait.
 */
export function profileGateKind({ isSignedIn, status }: { isSignedIn: boolean; status: MemberStatus | null }): ProfileGateKind {
  if (!isSignedIn) return "join";
  return status === "incomplete" ? "complete" : "wait";
}

export type MemberPageAccess =
  "loading-session" | "loading-profile" | "sign-in" | "profile-error" | "complete-profile" | "pending" | "allowed";

type MemberPageReader = {
  isLoading: boolean;
  isSignedIn: boolean;
  profileError: boolean;
  status: MemberStatus | null;
  /** Onboarding itself opens to any signed-in account. */
  allowIncomplete: boolean;
  /** A waiting account keeps its own profile, its editor and its password. */
  allowPending: boolean;
};

/** Who may open a members-only page; the page tells everyone else what they still need. */
export function memberPageAccess({ isLoading, isSignedIn, profileError, status, allowIncomplete, allowPending }: MemberPageReader): MemberPageAccess {
  if (isLoading) return "loading-session";
  if (!isSignedIn) return "sign-in";
  if (allowIncomplete) return "allowed";
  if (profileError) return "profile-error";
  if (status === null) return "loading-profile";
  if (status === "incomplete") return "complete-profile";
  return status === "pending" && !allowPending ? "pending" : "allowed";
}

export type OfferAccess = "demo" | "checking" | "members-only" | "incomplete" | "pending" | "profile-error" | "member";

/**
 * Offers point to real opportunities: a configured site shows them to active
 * members only. Signed-out visitors get a sign-in invitation rather than the
 * fictional showcase, which remains for a site without Supabase.
 */
export function offerAccessOf({ isConfigured, isLoading, isSignedIn, profileError, status }: {
  isConfigured: boolean; isLoading: boolean; isSignedIn: boolean; profileError: boolean; status: MemberStatus | null;
}): OfferAccess {
  if (!isConfigured) return "demo";
  if (isLoading) return "checking";
  if (!isSignedIn) return "members-only";
  if (profileError) return "profile-error";
  if (status === null) return "checking";
  return status === "active" ? "member" : status;
}
