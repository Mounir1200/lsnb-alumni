import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AccountPage } from "../components/auth/AccountPage";
import { GoogleAuthButton } from "../components/auth/GoogleAuthButton";
import { Button } from "../components/ui/Button";
import { FormStatus, type FormStatusValue } from "../components/ui/FormStatus";
import { useCountdown } from "../hooks/useCountdown";
import { getAuthCallbackUrl, getPostAuthPath } from "../lib/auth";
import { CONFIRMATION_RESEND_SUCCESS, getLoginError, resendSignupConfirmation } from "../lib/emailConfirmation";
import { FORGOT_PASSWORD_PATH } from "../lib/passwordRecovery";
import { createEmailLinkAuth, isSupabaseConfigured, supabase } from "../lib/supabase";

const RESEND_DELAY_SECONDS = 60;

export function LoginPage() {
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });
  const [email, setEmail] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const resend = useCountdown();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const nextPath = getPostAuthPath(searchParams.get("next"));
  const joinPath = searchParams.has("next") ? `/rejoindre?next=${encodeURIComponent(nextPath)}` : "/rejoindre";

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (googleBusy || status.kind === "loading") return;
    const data = new FormData(event.currentTarget);
    setStatus({ kind: "loading" });

    if (!supabase || !isSupabaseConfigured) {
      setStatus({
        kind: "success",
        message: "Mode démonstration actif. Configurez Supabase pour ouvrir une session réelle.",
      });
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: String(data.get("password") ?? "") });
      if (error) throw error;
      setStatus({ kind: "success", message: "Connexion réussie. Ouverture de votre espace…" });
      navigate(nextPath, { replace: true });
    } catch (error) { setStatus({ kind: "error", message: getLoginError(error) }); }
  };

  const handleResendConfirmation = async () => {
    if (googleBusy || status.kind === "loading" || resend.secondsLeft > 0) return;
    if (!supabase || !email) {
      setStatus({ kind: "error", message: "Saisissez d’abord votre adresse e-mail." });
      return;
    }

    setStatus({ kind: "loading", message: "Envoi d’un nouveau lien…" });
    try {
      await resendSignupConfirmation(createEmailLinkAuth(), email, getAuthCallbackUrl(searchParams.has("next") ? nextPath : null));
      resend.start(RESEND_DELAY_SECONDS);
      setStatus({ kind: "success", message: CONFIRMATION_RESEND_SUCCESS });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "L’envoi n’a pas abouti. Réessayez." });
    }
  };

  return (
    <AccountPage stop="Espace membre" title="Retrouver le réseau." intro="Connectez-vous pour consulter les contacts et gérer votre profil.">
        <form className="account-form" onSubmit={handleLogin}>
          <GoogleAuthButton next={nextPath} disabled={status.kind === "loading"} onBusyChange={setGoogleBusy} />
          <div className="auth-divider"><span>ou avec votre e-mail</span></div>
          <label className="field-group">
            <span>Adresse e-mail</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field-group"><span>Mot de passe</span><input name="password" type="password" autoComplete="current-password" required /></label>
          <Link className="login-page__recovery" to={FORGOT_PASSWORD_PATH} state={{ email }}>Mot de passe oublié&nbsp;?</Link>

          <FormStatus status={status} />

          <Button type="submit" size="lg" disabled={status.kind === "loading" || googleBusy}>
            {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
            Se connecter
          </Button>
          <button
            type="button"
            className="login-page__forgot"
            onClick={handleResendConfirmation}
            disabled={status.kind === "loading" || googleBusy || resend.secondsLeft > 0}
          >
            {resend.secondsLeft > 0 ? `Nouveau lien possible dans ${resend.secondsLeft} s` : "Renvoyer l’e-mail de confirmation"}
          </button>
          <p className="account-form__login">Pas encore membre&nbsp;? <Link to={joinPath}>Créer un compte</Link></p>
        </form>
    </AccountPage>
  );
}
