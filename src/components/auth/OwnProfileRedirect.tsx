import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

/** "Mon espace" is the member's own profile: links and sign-in returns to /espace land there. */
export function OwnProfileRedirect() {
  const { user } = useAuth();
  return user ? <Navigate to={`/alumni/${user.id}`} replace /> : null;
}
