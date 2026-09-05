import type { EmailOtpType, Session, SupabaseClient, User } from "@supabase/supabase-js";

type CallbackAuth = Pick<SupabaseClient["auth"], "initialize" | "getSession" | "verifyOtp">;
const emailTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export function callbackError(url: URL): string | null {
  const hash = new URLSearchParams(url.hash.slice(1));
  const error = url.searchParams.get("error") ?? hash.get("error");
  const description = url.searchParams.get("error_description") ?? hash.get("error_description");
  if (!error && !description) return null;
  if (error === "access_denied") return "La connexion a été annulée ou refusée. Vous pouvez réessayer.";
  return "La connexion n’a pas abouti. Réessayez depuis la page de connexion.";
}

// Capture provider errors before the SDK cleans the return URL. Supabase handles
// its configured flow on initialization; an already restored session must not exchange again.
export async function resolveCallbackUser(auth: CallbackAuth, url: URL, currentUrl: () => URL = () => url): Promise<User> {
  const errorMessage = callbackError(url);
  if (errorMessage) throw new Error(errorMessage);
  const initialized = await auth.initialize();
  if (initialized.error) throw new Error("Ce lien de connexion a expiré ou n’est plus valide. Recommencez la connexion.");
  let session: Session | null = null;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type && emailTypes.has(type)) {
    const result = await auth.verifyOtp({ token_hash: tokenHash, type });
    if (result.error) throw new Error("Ce lien de confirmation a expiré ou a déjà été utilisé.");
    session = result.data.session;
  } else {
    // A code remains in the URL when the SDK could not identify/consume its
    // verifier. Never pass an old session off as a successful new sign-in.
    if (url.searchParams.has("code") && currentUrl().searchParams.has("code")) {
      throw new Error("Ce lien de connexion ne peut pas être utilisé dans ce navigateur. Recommencez la connexion.");
    }
    if (tokenHash) throw new Error("Ce lien de confirmation n’est pas valide.");
    const initial = await auth.getSession();
    if (initial.error) throw new Error("La session n’a pas pu être ouverte. Réessayez de vous connecter.");
    session = initial.data.session;
  }
  if (!session) throw new Error("Aucune session n’a pu être ouverte. Réessayez avec Google ou votre adresse e-mail.");
  return session.user;
}
