import { AlertTriangle, LoaderCircle, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getPostAuthPath, getProfileCompletionPath } from "../lib/auth";
import { resolveCallbackUser } from "../lib/authCallback";
import { uploadPendingAvatar } from "../lib/avatarRepository";
import { loadOnboardingProfile } from "../lib/onboardingRepository";
import { FORGOT_PASSWORD_PATH, isPasswordResetReturn } from "../lib/passwordRecovery";
import { createLinkAuth, supabase } from "../lib/supabase";
import { RouteStop } from "../components/visual/RouteStop";

type CallbackCopy = { stop: string; failure: string; linkOpens: string; accept: string; retry: string; retryTo: (next: string) => string };

const SIGN_IN_COPY: CallbackCopy = {
  stop: "Connexion au réseau",
  failure: "La connexion n’a pas abouti.",
  linkOpens: "Ce lien ouvre le compte ci-dessous. Continuez uniquement si cette adresse vous appartient.",
  accept: "Oui, ouvrir mon compte",
  retry: "Revenir à la connexion",
  retryTo: (next) => `/connexion?${new URLSearchParams({ next })}`,
};

const PASSWORD_RESET_COPY: CallbackCopy = {
  stop: "Mot de passe oublié",
  failure: "Le lien n’a pas abouti.",
  linkOpens: "Ce lien permet de choisir un nouveau mot de passe pour le compte ci-dessous. Continuez uniquement si cette adresse vous appartient.",
  accept: "Oui, choisir mon mot de passe",
  retry: "Demander un nouveau lien",
  retryTo: () => FORGOT_PASSWORD_PATH,
};

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const returnUrl = useRef(new URL(window.location.href));
  const task = useRef<Promise<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ email: string; choose: (accept: boolean) => void } | null>(null);

  useEffect(() => {
    let active = true;
    task.current ??= (async () => {
      if (!supabase) throw new Error("La connexion n’est pas configurée sur ce site.");
      const user = await resolveCallbackUser(supabase.auth, returnUrl.current, () => new URL(window.location.href), {
        createAuth: createLinkAuth,
        confirmAccount: (account) => new Promise<boolean>((resolve) => {
          setConfirmation({ email: account.email!, choose: (accept) => { setConfirmation(null); resolve(accept); } });
        }),
      });
      const profile = await loadOnboardingProfile(user.id);
      const next = returnUrl.current.searchParams.get("next");
      if (!profile.profile_completed) return getProfileCompletionPath(next);
      let photoState = "";
      try {
        if (await uploadPendingAvatar(user)) photoState = "&photo=uploaded";
      } catch { photoState = "&photo=retry"; }
      return next ? getPostAuthPath(next) : `/espace?confirmed=true${photoState}`;
    })();
    void task.current.then((path) => { if (active) navigate(path, { replace: true }); }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "La connexion n’a pas abouti. Réessayez.");
    });
    return () => { active = false; };
  }, [navigate]);

  const requestedNext = returnUrl.current.searchParams.get("next");
  const copy = isPasswordResetReturn(requestedNext) ? PASSWORD_RESET_COPY : SIGN_IN_COPY;
  return (
    <div className="auth-state-page" role={error ? "alert" : "status"}>
      {error ? <AlertTriangle aria-hidden="true" /> : confirmation ? <UserRound aria-hidden="true" /> : <LoaderCircle className="spin" aria-hidden="true" />}
      <RouteStop>{copy.stop}</RouteStop>
      <h1>{error ? copy.failure : confirmation ? "Est-ce bien votre compte ?" : "Un dernier passage."}</h1>
      <p>{error ?? (confirmation ? copy.linkOpens : "Ouverture de votre session…")}</p>
      {confirmation && <>
        <p><strong>{confirmation.email}</strong></p>
        <button className="button button--primary button--md" onClick={() => confirmation.choose(true)}>{copy.accept}</button>
        <button className="button button--secondary button--md" onClick={() => confirmation.choose(false)}>Annuler</button>
      </>}
      {error && <Link className="button button--primary button--md" to={copy.retryTo(getPostAuthPath(requestedNext))}>{copy.retry}</Link>}
    </div>
  );
}
