import { supabase } from "./supabase";
import { createMessagingIdentityRepository } from "./messagingIdentityData";

export const { loadIdentity, requestIdentityChallenge, enrollIdentity } = createMessagingIdentityRepository(
  supabase, (import.meta.env.VITE_API_URL ?? "").trim(),
);
