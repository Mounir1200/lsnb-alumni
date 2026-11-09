import { createClient } from "@supabase/supabase-js";
import { browserAuthOptions, emailLinkAuthOptions, linkAuthOptions } from "./authOptions";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: browserAuthOptions,
    })
  : null;

/** A short-lived client that never touches the shared session (see authOptions.ts). */
function createIsolatedAuth(auth: typeof linkAuthOptions | typeof emailLinkAuthOptions) {
  if (!isSupabaseConfigured) throw new Error("La connexion n’est pas configurée sur ce site.");
  return createClient(supabaseUrl!, supabaseAnonKey!, { auth }).auth;
}

export const createLinkAuth = () => createIsolatedAuth(linkAuthOptions);
export const createEmailLinkAuth = () => createIsolatedAuth(emailLinkAuthOptions);
