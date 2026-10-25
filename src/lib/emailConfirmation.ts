import type { SupabaseClient } from "@supabase/supabase-js";

export const CONFIRMATION_RESEND_SUCCESS = "Si cette adresse correspond à un compte en attente de confirmation, un nouveau lien a été envoyé. Vérifiez aussi les courriers indésirables.";

export async function registerEmailAccount(
  auth: Pick<SupabaseClient["auth"], "setSession">,
  signupAuth: Pick<SupabaseClient["auth"], "signUp">,
  credentials: Parameters<SupabaseClient["auth"]["signUp"]>[0],
) {
  const result = await signupAuth.signUp(credentials);
  if (result.error || !result.data.session) return { ...result, signInRequired: false };
  // This session follows the member's own submitted signup, never a URL.
  const { access_token, refresh_token } = result.data.session;
  const installed = await auth.setSession({ access_token, refresh_token });
  // The account exists either way: ask for a sign-in rather than letting the member sign up twice.
  if (installed.error) return { ...result, data: { ...result.data, session: null }, signInRequired: true };
  return { ...result, signInRequired: false };
}

export function getLoginError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "email_not_confirmed") return "Confirmez d’abord votre adresse e-mail. Vous pouvez demander un nouveau lien ci-dessous.";
  if (code === "invalid_credentials") return "L’adresse e-mail ou le mot de passe est incorrect.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return "Trop de tentatives rapprochées. Patientez un peu avant de réessayer.";
  return "La connexion n’a pas abouti. Vérifiez votre connexion internet et réessayez.";
}

export async function resendSignupConfirmation(auth: Pick<SupabaseClient["auth"], "resend">, email: string, redirectTo: string) {
  const address = email.trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) throw new Error("Saisissez une adresse e-mail valide avant de demander un nouveau lien.");
  try {
    const { error } = await auth.resend({ type: "signup", email: address, options: { emailRedirectTo: redirectTo } });
    if (error) {
      if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
        throw new Error("Patientez une minute avant de demander un nouveau lien.");
      }
      throw new Error("L’e-mail de confirmation n’a pas pu être envoyé. Réessayez dans un instant.");
    }
  } catch (cause) {
    // Keep the explicit local errors; never expose a provider response or network detail.
    if (cause instanceof Error && [
      "Patientez une minute avant de demander un nouveau lien.",
      "L’e-mail de confirmation n’a pas pu être envoyé. Réessayez dans un instant.",
    ].includes(cause.message)) throw cause;
    throw new Error("L’e-mail de confirmation n’a pas pu être envoyé. Vérifiez votre connexion internet et réessayez.");
  }
}
