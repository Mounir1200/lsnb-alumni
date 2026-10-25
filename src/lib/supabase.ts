import { createClient } from "@supabase/supabase-js";
import { browserAuthOptions, emailSignupAuthOptions, linkAuthOptions } from "./authOptions";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: browserAuthOptions,
    })
  : null;

export function createLinkAuth() {
  if (!isSupabaseConfigured) throw new Error("La connexion n’est pas configurée sur ce site.");
  return createClient(supabaseUrl!, supabaseAnonKey!, { auth: linkAuthOptions }).auth;
}

export function createEmailSignupAuth() {
  if (!isSupabaseConfigured) throw new Error("La connexion n’est pas configurée sur ce site.");
  return createClient(supabaseUrl!, supabaseAnonKey!, { auth: emailSignupAuthOptions }).auth;
}
