import type { SupabaseClient } from "@supabase/supabase-js";
import { authFailure, isRateLimited, OFFLINE } from "./authErrors";
import { errorCode } from "./errorCode";

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
  const code = errorCode(error);
  if (code === "email_not_confirmed") return "Confirmez d’abord votre adresse e-mail. Vous pouvez demander un nouveau lien ci-dessous.";
  if (code === "invalid_credentials") return "L’adresse e-mail ou le mot de passe est incorrect.";
  if (isRateLimited(error)) return "Trop de tentatives rapprochées. Patientez un peu avant de réessayer.";
  return "La connexion n’a pas abouti. Vérifiez votre connexion internet et réessayez.";
}

/** Trims the typed address and refuses one that cannot receive a link. */
export function requireEmailAddress(email: string) {
  const address = email.trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) throw new Error("Saisissez une adresse e-mail valide avant de demander un nouveau lien.");
  return address;
}

/**
 * Sends an account email (confirmation or password reset) and words its failures for
 * members, without any provider response or network detail. Supabase answers the same
 * way whether or not the address has an account, so success reveals nothing either.
 */
export async function sendAccountEmail(send: () => Promise<{ error: unknown }>, subject: string) {
  const failure = await authFailure(send);
  if (failure === null) return;
  if (failure === OFFLINE) throw new Error(`${subject} n’a pas pu être envoyé. Vérifiez votre connexion internet et réessayez.`);
  throw new Error(isRateLimited(failure) ? "Patientez une minute avant de demander un nouveau lien." : `${subject} n’a pas pu être envoyé. Réessayez dans un instant.`);
}

export async function resendSignupConfirmation(auth: Pick<SupabaseClient["auth"], "resend">, email: string, redirectTo: string) {
  const address = requireEmailAddress(email);
  await sendAccountEmail(() => auth.resend({ type: "signup", email: address, options: { emailRedirectTo: redirectTo } }), "L’e-mail de confirmation");
}
