import type { EmailOtpType } from "@supabase/supabase-js";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { uploadPendingAvatar } from "../lib/avatarRepository";
import { supabase } from "../lib/supabase";

type CallbackStatus = {
  kind: "loading" | "error";
  message: string;
};

function readCallbackError(url: URL) {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return url.searchParams.get("error_description") ?? hash.get("error_description");
}

export function AuthCallbackPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);
  const [status, setStatus] = useState<CallbackStatus>({
    kind: "loading",
    message: "Validation de votre adresse et ouverture de la session…",
  });

  useEffect(() => {
    if (isLoading || started.current) return;
    started.current = true;

    const completeAuthentication = async () => {
      if (!supabase) throw new Error("Supabase n’est pas configuré sur ce site.");

      let confirmedUser = user;

      if (!confirmedUser) {
        const url = new URL(window.location.href);
        const callbackError = readCallbackError(url);
        if (callbackError) throw new Error(callbackError);

        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type") as EmailOtpType | null;

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          throw new Error("Le lien a été validé, mais aucune session n’a pu être ouverte. Connectez-vous avec votre mot de passe.");
        }
        confirmedUser = data.session.user;
      }

      let photoState = "";
      try {
        const photoUrl = await uploadPendingAvatar(confirmedUser);
        if (photoUrl) photoState = "&photo=uploaded";
      } catch {
        photoState = "&photo=retry";
      }

      navigate(`/espace?confirmed=true${photoState}`, { replace: true });
    };

    void completeAuthentication().catch((error: unknown) => {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Ce lien de confirmation n’est plus valide.",
      });
    });
  }, [isLoading, navigate, user]);

  return (
    <div className="auth-state-page">
      {status.kind === "loading" ? (
        <LoaderCircle className="spin" aria-hidden="true" />
      ) : (
        <AlertTriangle aria-hidden="true" />
      )}
      <p className="eyebrow">Confirmation du compte</p>
      <h1>{status.kind === "loading" ? "Un dernier passage." : "Le lien n’a pas abouti."}</h1>
      <p>{status.message}</p>
      {status.kind === "error" && (
        <Link className="button button--primary button--md" to="/connexion">
          <CheckCircle2 aria-hidden="true" />
          Aller à la connexion
        </Link>
      )}
    </div>
  );
}
