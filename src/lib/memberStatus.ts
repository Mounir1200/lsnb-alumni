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
