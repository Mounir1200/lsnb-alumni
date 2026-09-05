import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { getProfileCompletionPath } from "../../lib/auth";
import { Button } from "../ui/Button";

export function RequireAuth({ children, allowIncomplete = false }: { children: ReactNode; allowIncomplete?: boolean }) {
  const { user, isLoading, profileCompleted, profileError, refreshProfile } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-state-page" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Ouverture de votre espace…</p>
      </div>
    );
  }

  if (!user) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/connexion?next=${encodeURIComponent(next)}`} replace />;
  }

  if (!allowIncomplete) {
    if (profileError) return (
      <div className="auth-state-page" role="alert">
        <p>{profileError}</p>
        <Button onClick={() => void refreshProfile()}>Réessayer</Button>
      </div>
    );
    if (profileCompleted === null) return (
      <div className="auth-state-page" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>Chargement de votre profil…</p></div>
    );
    if (!profileCompleted) return <Navigate to={getProfileCompletionPath(`${location.pathname}${location.search}${location.hash}`)} replace />;
  }

  return children;
}
