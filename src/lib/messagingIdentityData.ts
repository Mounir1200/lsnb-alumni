import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingIdentity } from "./messagingCrypto";

export type IdentityChallenge = { challengeId: string; expiresAt: string };

export function createMessagingIdentityRepository(client: SupabaseClient | null, apiUrl: string, fetcher: typeof fetch = fetch) {
  async function loadIdentity(): Promise<MessagingIdentity | null> {
    if (!client) throw new Error("La messagerie n’est pas disponible.");
    const { data, error } = await client.rpc("messaging_get_identity");
    if (error) throw new Error("Impossible de vérifier votre clé de messagerie. Réessayez.");
    const identity = Array.isArray(data) ? data[0] : data;
    return identity ?? null;
  }

  async function identityRequest(userId: string, path: string, body: unknown) {
    if (!client || !apiUrl) throw new Error("La vérification par e-mail n’est pas encore disponible.");
    const { data, error } = await client.auth.getSession();
    if (error || data.session?.user.id !== userId) throw new Error("Votre session a changé. Reconnectez-vous.");
    const response = await fetcher(`${apiUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 409) throw new Error("Une clé est déjà enregistrée. Rechargez la page pour déverrouiller votre messagerie.");
      if (response.status === 429) throw new Error("Patientez une minute avant une nouvelle tentative.");
      if (response.status === 503) throw new Error("Le service de vérification par e-mail est indisponible. Réessayez plus tard.");
      if (response.status === 400) throw new Error("Le code est incorrect, expiré ou déjà utilisé. Demandez un nouveau code si nécessaire.");
      throw new Error("La vérification n’a pas abouti. Vérifiez votre connexion et réessayez.");
    }
    return response;
  }

  async function requestIdentityChallenge(userId: string): Promise<IdentityChallenge> {
    const response = await identityRequest(userId, "/messaging/identity/challenge", {});
    const challenge = await response.json() as IdentityChallenge;
    if (!challenge.challengeId || !challenge.expiresAt) throw new Error("La vérification n’a pas pu démarrer.");
    return challenge;
  }

  async function enrollIdentity(userId: string, identity: MessagingIdentity, challenge: IdentityChallenge, code: string) {
    if (!/^\d{8}$/.test(code) || identity.user_id !== userId) throw new Error("Saisissez les 8 chiffres du code reçu par e-mail.");
    await identityRequest(userId, "/messaging/identity", {
      challengeId: challenge.challengeId, code, publicKey: identity.public_key,
      encryptedPrivateKey: identity.encrypted_private_key,
    });
  }
  return { loadIdentity, requestIdentityChallenge, enrollIdentity };
}
