import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { getProfileCompletionPath } from "../../lib/auth";
import { memberPageAccess } from "../../lib/memberStatus";
import { Button } from "../ui/Button";
import { PendingApproval } from "./PendingApproval";

type RequireAuthProps = { children: ReactNode; allowIncomplete?: boolean; allowPending?: boolean };

function Waiting({ text }: { text: string }) {
  return (
    <div className="auth-state-page" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function RequireAuth({ children, allowIncomplete = false, allowPending = false }: RequireAuthProps) {
  const { user, isLoading, memberStatus, profileError, refreshProfile } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}${location.hash}`;
  const access = memberPageAccess({
    isLoading, isSignedIn: Boolean(user), profileError: Boolean(profileError), status: memberStatus, allowIncomplete, allowPending,
  });

  switch (access) {
    case "loading-session": return <Waiting text="Ouverture de votre espace…" />;
    case "loading-profile": return <Waiting text="Chargement de votre profil…" />;
    case "sign-in": return <Navigate to={`/connexion?next=${encodeURIComponent(here)}`} replace />;
    case "profile-error": return (
      <div className="auth-state-page" role="alert">
        <p>{profileError}</p>
        <Button onClick={() => void refreshProfile()}>Réessayer</Button>
      </div>
    );
    case "complete-profile": return <Navigate to={getProfileCompletionPath(here)} replace />;
    case "pending": return <PendingApproval />;
    case "allowed": return children;
  }
}
