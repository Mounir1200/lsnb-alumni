import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getPostAuthPath, getProfileCompletionPath } from "../lib/auth";
import { resolveCallbackUser } from "../lib/authCallback";
import { uploadPendingAvatar } from "../lib/avatarRepository";
import { loadOnboardingProfile } from "../lib/onboardingRepository";
import { supabase } from "../lib/supabase";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const returnUrl = useRef(new URL(window.location.href));
  const task = useRef<Promise<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    task.current ??= (async () => {
      if (!supabase) throw new Error("La connexion n’est pas configurée sur ce site.");
      const user = await resolveCallbackUser(supabase.auth, returnUrl.current, () => new URL(window.location.href));
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

  const next = getPostAuthPath(returnUrl.current.searchParams.get("next"));
  return (
    <div className="auth-state-page" role={error ? "alert" : "status"}>
      {error ? <AlertTriangle aria-hidden="true" /> : <LoaderCircle className="spin" aria-hidden="true" />}
      <p className="eyebrow">Connexion au réseau</p>
      <h1>{error ? "La connexion n’a pas abouti." : "Un dernier passage."}</h1>
      <p>{error ?? "Ouverture de votre session…"}</p>
      {error && <Link className="button button--primary button--md" to={`/connexion?${new URLSearchParams({ next })}`}>Revenir à la connexion</Link>}
    </div>
  );
}
