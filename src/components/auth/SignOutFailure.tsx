import "./SignOutFailure.css";

/**
 * Shown where the member asked to sign out, when the session could not be ended.
 * supabase-js answers a new attempt from its last failure for a minute, hence
 * "dans un moment".
 */
export function SignOutFailure() {
  return (
    <div className="form-status form-status--error sign-out-failure" role="alert">
      La déconnexion a échoué et votre session reste ouverte sur cet appareil. Vérifiez votre connexion Internet, puis
      réessayez dans un moment.
    </div>
  );
}
