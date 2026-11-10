import { ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AccountPage } from "../components/auth/AccountPage";
import { Button, ButtonLink } from "../components/ui/Button";
import { FormStatus, type FormStatusValue } from "../components/ui/FormStatus";
import { FORGOT_PASSWORD_PATH, MIN_PASSWORD_LENGTH, savedPasswordMessage, updatePassword, type SavedPassword } from "../lib/passwordRecovery";
import { supabase } from "../lib/supabase";

export function NewPasswordPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });
  const [saved, setSaved] = useState<SavedPassword | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status.kind === "loading" || !supabase) return;
    const data = new FormData(event.currentTarget);
    setStatus({ kind: "loading", message: "Enregistrement du mot de passe…" });
    try {
      setSaved(await updatePassword(supabase.auth, String(data.get("password") ?? ""), String(data.get("confirmation") ?? "")));
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Le mot de passe n’a pas pu être enregistré. Réessayez." });
    }
  };

  if (saved) {
    return (
      <AccountPage stop="Mot de passe" title="Mot de passe enregistré." intro={savedPasswordMessage(saved)}>
        <ButtonLink to="/espace" size="lg">Ouvrir mon espace <ArrowRight size={18} aria-hidden="true" /></ButtonLink>
      </AccountPage>
    );
  }

  return (
    <AccountPage stop="Mot de passe" title="Choisissez un nouveau mot de passe." intro={<>Pour le compte <strong>{user?.email}</strong>.</>}>
      <form className="account-form" onSubmit={handleSubmit}>
        <label className="field-group">
          <span>Nouveau mot de passe</span>
          <input name="password" type="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" required />
          <small>{MIN_PASSWORD_LENGTH} caractères minimum.</small>
        </label>
        <label className="field-group">
          <span>Confirmez le nouveau mot de passe</span>
          <input name="confirmation" type="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" required />
        </label>

        <FormStatus status={status} />
        {status.kind === "error" && <p className="account-back"><Link to={FORGOT_PASSWORD_PATH}>Demander un nouveau lien</Link></p>}

        <Button type="submit" size="lg" disabled={status.kind === "loading"}>Enregistrer le mot de passe</Button>
      </form>
    </AccountPage>
  );
}
