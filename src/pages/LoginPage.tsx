import { Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { GoogleAuthButton } from "../components/auth/GoogleAuthButton";
import { Button } from "../components/ui/Button";
import { BrandMark } from "../components/ui/BrandMark";
import { getAuthCallbackUrl, getPostAuthPath } from "../lib/auth";
import { CONFIRMATION_RESEND_SUCCESS, getLoginError, resendSignupConfirmation } from "../lib/emailConfirmation";
import { createEmailSignupAuth, isSupabaseConfigured, supabase } from "../lib/supabase";

type LoginStatus = { kind: "idle" | "loading" | "success" | "error"; message?: string };

export function LoginPage() {
  const [status, setStatus] = useState<LoginStatus>({ kind: "idle" });
  const [email, setEmail] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const nextPath = getPostAuthPath(searchParams.get("next"));
  const joinPath = searchParams.has("next") ? `/rejoindre?next=${encodeURIComponent(nextPath)}` : "/rejoindre";

  useEffect(() => {
    if (!resendCooldown) return;
    const timeout = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [resendCooldown]);

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
    if (googleBusy || status.kind === "loading" || resendCooldown > 0) return;
    if (!supabase || !email) {
      setStatus({ kind: "error", message: "Saisissez d’abord votre adresse e-mail." });
      return;
    }

    setStatus({ kind: "loading", message: "Envoi d’un nouveau lien…" });
    try {
      await resendSignupConfirmation(createEmailSignupAuth(), email, getAuthCallbackUrl(searchParams.has("next") ? nextPath : null));
      setResendCooldown(60);
      setStatus({ kind: "success", message: CONFIRMATION_RESEND_SUCCESS });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "L’envoi n’a pas abouti. Réessayez." });
    }
  };

  return (
    <div className="login-page">
      <div className="login-page__panel">
        <BrandMark className="login-page__brand" />
        <div className="login-page__heading">
          <p className="eyebrow eyebrow--dark">Espace membre</p>
          <h1>Retrouver le réseau.</h1>
          <p>Connectez-vous pour consulter les contacts et gérer votre profil.</p>
        </div>

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

          {status.kind !== "idle" && status.message && (
            <div className={`form-status form-status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
              {status.kind === "success" ? <Check aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
              {status.message}
            </div>
          )}

          <Button type="submit" size="lg" disabled={status.kind === "loading" || googleBusy}>
            {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
            Se connecter
          </Button>
          <button
            type="button"
            className="login-page__forgot"
            onClick={handleResendConfirmation}
            disabled={status.kind === "loading" || googleBusy || resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Nouveau lien possible dans ${resendCooldown} s` : "Renvoyer l’e-mail de confirmation"}
          </button>
          <p className="account-form__login">Pas encore membre&nbsp;? <Link to={joinPath}>Créer un compte</Link></p>
        </form>
      </div>

      <aside className="login-page__visual" aria-hidden="true">
        <img src="/images/mentoring-lab.jpg" alt="" />
        <blockquote>“Une trajectoire devient plus lisible quand quelqu’un accepte d’en partager les détours.”</blockquote>
      </aside>
    </div>
  );
}
