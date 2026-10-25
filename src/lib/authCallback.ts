import type { EmailOtpType, Session, SupabaseClient, User } from "@supabase/supabase-js";

type CallbackAuth = Pick<SupabaseClient["auth"], "initialize" | "getSession" | "setSession">;
type LinkConfirmation = {
  createAuth: () => Pick<SupabaseClient["auth"], "verifyOtp" | "setSession">;
  confirmAccount: (user: User) => Promise<boolean>;
};
const emailTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

function callbackParameters(url: URL) {
  const params = new URLSearchParams(url.hash.slice(1));
  url.searchParams.forEach((value, key) => params.set(key, value));
  return params;
}

export function hasAuthCallback(url: URL) {
  const params = callbackParameters(url);
  return ["access_token", "refresh_token", "code", "token_hash"].some((key) => params.has(key));
}

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
export async function resolveCallbackUser(auth: CallbackAuth, url: URL, currentUrl: () => URL = () => url, confirmation?: LinkConfirmation): Promise<User> {
  const errorMessage = callbackError(url);
  if (errorMessage) throw new Error(errorMessage);
  let session: Session | null = null;
  const params = callbackParameters(url);
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const implicit = params.has("access_token") || params.has("refresh_token");
  if (tokenHash || implicit) {
    if (!confirmation || params.has("code") || (tokenHash && implicit)
      || (tokenHash && (!type || !emailTypes.has(type)))
      || (implicit && (!params.get("access_token") || !params.get("refresh_token")))) {
      throw new Error("Ce lien de confirmation n’est pas valide.");
    }
    const isolatedAuth = confirmation.createAuth();
    const result = tokenHash
      ? await isolatedAuth.verifyOtp({ token_hash: tokenHash, type: type! })
      : await isolatedAuth.setSession({ access_token: params.get("access_token")!, refresh_token: params.get("refresh_token")! });
    if (result.error) throw new Error("Ce lien de confirmation a expiré ou a déjà été utilisé.");
    session = result.data.session;
    if (!session?.user.email) throw new Error("Ce lien ne permet pas de vérifier l’adresse du compte.");
    if (!await confirmation.confirmAccount(session.user)) throw new Error("La connexion à ce compte a été annulée.");
    const installed = await auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (installed.error || installed.data.user?.id !== session.user.id) throw new Error("La session n’a pas pu être ouverte. Réessayez de vous connecter.");
    return installed.data.user;
  } else {
    const initialized = await auth.initialize();
    if (initialized.error) throw new Error("Ce lien de connexion a expiré ou n’est plus valide. Recommencez la connexion.");
    // A code remains in the URL when the SDK could not identify/consume its
    // verifier. Never pass an old session off as a successful new sign-in.
    if (params.has("code") && callbackParameters(currentUrl()).has("code")) {
      throw new Error("Ce lien de connexion ne peut pas être utilisé dans ce navigateur. Recommencez la connexion.");
    }
    const initial = await auth.getSession();
    if (initial.error) throw new Error("La session n’a pas pu être ouverte. Réessayez de vous connecter.");
    session = initial.data.session;
  }
  if (!session) throw new Error("Aucune session n’a pu être ouverte. Réessayez avec Google ou votre adresse e-mail.");
  return session.user;
}
