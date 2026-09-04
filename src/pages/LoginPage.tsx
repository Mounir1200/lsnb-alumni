import { Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { BrandMark } from "../components/ui/BrandMark";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type LoginStatus = { kind: "idle" | "loading" | "success" | "error"; message?: string };

export function LoginPage() {
  const [status, setStatus] = useState<LoginStatus>({ kind: "idle" });

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setStatus({ kind: "loading" });

    if (!supabase || !isSupabaseConfigured) {
      setStatus({
        kind: "success",
        message: "Mode démonstration actif. Configurez Supabase pour ouvrir une session réelle.",
      });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    });

    setStatus(
      error
        ? { kind: "error", message: error.message }
        : { kind: "success", message: "Connexion réussie. Votre espace membre est prêt." },
    );
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
          <label className="field-group"><span>Adresse e-mail</span><input name="email" type="email" autoComplete="email" required /></label>
          <label className="field-group"><span>Mot de passe</span><input name="password" type="password" autoComplete="current-password" required /></label>

          {status.kind !== "idle" && status.message && (
            <div className={`form-status form-status--${status.kind}`} role="status">
              {status.kind === "success" ? <Check aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
              {status.message}
            </div>
          )}

          <Button type="submit" size="lg" disabled={status.kind === "loading"}>
            {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
            Se connecter
          </Button>
          <p className="account-form__login">Pas encore membre&nbsp;? <Link to="/rejoindre">Créer un compte</Link></p>
        </form>
      </div>

      <aside className="login-page__visual" aria-hidden="true">
        <img src="/images/mentoring-lab.jpg" alt="" />
        <blockquote>“Une trajectoire devient plus lisible quand quelqu’un accepte d’en partager les détours.”</blockquote>
      </aside>
    </div>
  );
}
