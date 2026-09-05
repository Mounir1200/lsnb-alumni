import type { SupabaseClient } from "@supabase/supabase-js";

export async function beginGoogleOAuth(auth: Pick<SupabaseClient["auth"], "signInWithOAuth">, redirectTo: string) {
  try {
    const { data, error } = await auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, scopes: "openid email profile", queryParams: { prompt: "select_account" } },
    });
    if (error || !data.url) throw new Error("OAuth unavailable");
  } catch {
    throw new Error("La connexion Google n’a pas pu démarrer. Réessayez ou utilisez votre adresse e-mail.");
  }
}
