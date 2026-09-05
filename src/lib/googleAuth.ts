import { getAuthCallbackUrl, getPostAuthPath } from "./auth";
import { supabase } from "./supabase";
import { beginGoogleOAuth } from "./googleOAuth";

export async function startGoogleSignIn(next?: string | null): Promise<void> {
  if (!supabase) throw new Error("La connexion Google n’est pas disponible en mode démonstration.");
  await beginGoogleOAuth(supabase.auth, getAuthCallbackUrl(getPostAuthPath(next ?? null)));
}
