import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
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

  return children;
}
