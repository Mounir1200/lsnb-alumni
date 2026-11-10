import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { AccountPage } from "../components/auth/AccountPage";
import { Button } from "../components/ui/Button";
import { FormStatus, type FormStatusValue } from "../components/ui/FormStatus";
import { useCountdown } from "../hooks/useCountdown";
import { getAuthCallbackUrl } from "../lib/auth";
import { emailFromRouterState, NEW_PASSWORD_PATH, RESET_LINK_SENT, requestPasswordReset } from "../lib/passwordRecovery";
import { createEmailLinkAuth, isSupabaseConfigured } from "../lib/supabase";

const RESEND_DELAY_SECONDS = 60;

export function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState(() => emailFromRouterState(location.state));
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });
  const resend = useCountdown();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status.kind === "loading" || resend.secondsLeft > 0) return;
    if (!isSupabaseConfigured) {
      setStatus({ kind: "success", message: "Mode démonstration actif. Configurez Supabase pour envoyer un vrai lien." });
      return;
    }
    setStatus({ kind: "loading", message: "Envoi du lien…" });
    try {
      await requestPasswordReset(createEmailLinkAuth(), email, getAuthCallbackUrl(NEW_PASSWORD_PATH));
      resend.start(RESEND_DELAY_SECONDS);
      setStatus({ kind: "success", message: RESET_LINK_SENT });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "L’envoi n’a pas abouti. Réessayez." });
    }
  };

  return (
    <AccountPage
      stop="Espace membre"
      title="Mot de passe oublié ?"
      intro="Indiquez l’adresse e-mail de votre compte. Nous vous enverrons un lien pour choisir un nouveau mot de passe."
    >
      <form className="account-form" onSubmit={handleSubmit}>
        <label className="field-group">
          <span>Adresse e-mail</span>
          <input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>

        <FormStatus status={status} />

        <Button type="submit" size="lg" disabled={status.kind === "loading" || resend.secondsLeft > 0}>
          {resend.secondsLeft > 0 ? `Nouveau lien possible dans ${resend.secondsLeft} s` : "Recevoir le lien"}
        </Button>

        <p className="account-hint">
          Vous vous connectez avec Google&nbsp;? Votre compte n’a pas besoin de mot de passe&nbsp;:
          revenez à la connexion et choisissez «&nbsp;Continuer avec Google&nbsp;».
        </p>
        <p className="account-back"><ArrowLeft aria-hidden="true" /><Link to="/connexion">Revenir à la connexion</Link></p>
      </form>
    </AccountPage>
  );
}
