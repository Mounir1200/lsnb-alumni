import type { SupabaseClient } from "@supabase/supabase-js";
import { getSafeNextPath } from "./auth";
import { authFailure, isRateLimited, OFFLINE } from "./authErrors";
import { requireEmailAddress, sendAccountEmail } from "./emailConfirmation";
import { errorCode } from "./errorCode";

export const FORGOT_PASSWORD_PATH = "/mot-de-passe-oublie";
export const NEW_PASSWORD_PATH = "/nouveau-mot-de-passe";
export const MIN_PASSWORD_LENGTH = 8;
export const RESET_LINK_SENT = "Si un compte existe pour cette adresse, un lien pour choisir un nouveau mot de passe vient d’y être envoyé. Pensez à regarder dans les courriers indésirables.";

type ResetAuth = Pick<SupabaseClient["auth"], "resetPasswordForEmail">;
type PasswordAuth = Pick<SupabaseClient["auth"], "updateUser" | "signOut">;
export type SavedPassword = { otherDevicesSignedOut: boolean };

const ASK_FOR_A_NEW_LINK = "Pour votre sécurité, ce lien n’est plus valable. Demandez un nouveau lien, puis recommencez.";
const PASSWORD_UPDATE_ERRORS: Record<string, string> = {
  same_password: "Choisissez un mot de passe différent de l’ancien.",
  weak_password: "Ce mot de passe est trop facile à deviner. Choisissez-en un plus long, qui mélange lettres et chiffres.",
  session_not_found: ASK_FOR_A_NEW_LINK,
  session_expired: ASK_FOR_A_NEW_LINK,
  reauthentication_needed: ASK_FOR_A_NEW_LINK,
};

/** Sends a reset link; `redirectTo` comes back through the auth callback to the new password page. */
export async function requestPasswordReset(auth: ResetAuth, email: string, redirectTo: string) {
  const address = requireEmailAddress(email);
  await sendAccountEmail(() => auth.resetPasswordForEmail(address, { redirectTo }), "Le lien");
}

export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Choisissez un mot de passe d’au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (password !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}

/** Saves the new password, then closes the member's other sessions, as after any reset. */
export async function updatePassword(auth: PasswordAuth, password: string, confirmation: string): Promise<SavedPassword> {
  const problem = passwordProblem(password, confirmation);
  if (problem) throw new Error(problem);
  const failure = await authFailure(() => auth.updateUser({ password }));
  if (failure !== null) throw new Error(passwordUpdateError(failure));
  return { otherDevicesSignedOut: await authFailure(() => auth.signOut({ scope: "others" })) === null };
}

function passwordUpdateError(failure: unknown) {
  if (failure === OFFLINE) return "Le mot de passe n’a pas pu être enregistré. Vérifiez votre connexion internet et réessayez.";
  if (isRateLimited(failure)) return "Trop de tentatives rapprochées. Patientez un peu avant de réessayer.";
  return PASSWORD_UPDATE_ERRORS[errorCode(failure)] ?? "Le mot de passe n’a pas pu être enregistré. Réessayez dans un instant.";
}

/** The sign-in page passes the address already typed, so the member does not type it twice. */
export function emailFromRouterState(state: unknown) {
  if (!state || typeof state !== "object" || !("email" in state)) return "";
  return typeof state.email === "string" ? state.email : "";
}

export function savedPasswordMessage({ otherDevicesSignedOut }: SavedPassword) {
  return otherDevicesSignedOut
    ? "Vous restez connecté sur cet appareil. Vos autres appareils ont été déconnectés : reconnectez-vous-y avec ce nouveau mot de passe."
    : "Vous restez connecté sur cet appareil. Utilisez ce nouveau mot de passe lors de vos prochaines connexions.";
}

/** Reset links return with `next` set to the new password page; nothing else does. */
export function isPasswordResetReturn(next: string | null) {
  return next !== null && new URL(getSafeNextPath(next), "https://lsnb.invalid").pathname === NEW_PASSWORD_PATH;
}
