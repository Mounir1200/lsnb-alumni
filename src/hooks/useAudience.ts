import { useAuth } from "../auth/AuthProvider";
import { audienceOf, type Audience } from "../lib/invitations";

export function useAudience(): Audience {
  const { user, isLoading, memberRole } = useAuth();
  return audienceOf({ isLoading, isSignedIn: Boolean(user), memberRole });
}
