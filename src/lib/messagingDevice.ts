import type { SupabaseClient } from "@supabase/supabase-js";

/** This browser's right to use messaging for one sign-in. The page can use the key but never read it. */
export type MessagingDevice = { userId: string; sessionId: string; key: CryptoKey; clockOffset: number };
export type MessagingProof = { issued_at: number; signature: string };
export type DeviceStore = {
  load(userId: string): Promise<MessagingDevice | null>;
  save(device: MessagingDevice): Promise<void>;
  clear(): Promise<void>;
};

/** "reconnect": a new sign-in is needed on this device. "unavailable": messaging cannot be reached. */
export type DeviceAccessProblem = "reconnect" | "unavailable";
export class DeviceAccessError extends Error {
  constructor(readonly problem: DeviceAccessProblem) {
    super(problem === "reconnect"
      ? "Reconnectez-vous pour afficher vos messages sur cet appareil."
      : "La messagerie est indisponible pour le moment. Réessayez dans un instant.");
  }
}

const PROOF_VERSION = "lsnb-messaging-v1";
// Error codes raised by the device-bound messaging migration.
const SESSION_INVALID = "LS401";
const PROOF_REJECTED = "LS403";
const DEVICE_EXISTS = "LS409";
const SIGN_IN_TOO_OLD = "LS428";
const DUPLICATE_KEY = "23505";
const RECONNECT_CODES = new Set([SESSION_INVALID, PROOF_REJECTED, SIGN_IN_TOO_OLD]);
const OTHER_TAB_DELAY_MS = 400;

export function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

export function needsReconnect(error: unknown) {
  return error instanceof DeviceAccessError ? error.problem === "reconnect" : RECONNECT_CODES.has(errorCode(error));
}

/** Reads the session identifier from the access token; the server checks it, not this function. */
export function sessionIdFromToken(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1] ?? "";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims: unknown = JSON.parse(atob(base64));
    return claims && typeof claims === "object" && "session_id" in claims && typeof claims.session_id === "string"
      ? claims.session_id : null;
  } catch { return null; }
}

const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export async function importDeviceKey(base64Key: string) {
  const raw = Uint8Array.from(atob(base64Key), (character) => character.charCodeAt(0));
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  } finally { raw.fill(0); }
}

/** Signs one call: the server recomputes the same HMAC over the action and its exact arguments. */
export async function createProof(device: MessagingDevice, action: string, payload: string, now = Date.now()): Promise<MessagingProof> {
  const issuedAt = Math.round(now + device.clockOffset);
  const message = [PROOF_VERSION, action, device.sessionId, String(issuedAt), payload].join("|");
  const signature = await crypto.subtle.sign("HMAC", device.key, new TextEncoder().encode(message));
  return { issued_at: issuedAt, signature: toBase64(signature) };
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });

export function createDeviceManager(client: SupabaseClient | null, store: DeviceStore, wait = pause) {
  // Kept in memory as well, so a browser that refuses storage still works until the page closes.
  let current: MessagingDevice | null = null;
  let registration: { sessionId: string; device: Promise<MessagingDevice> } | null = null;

  async function currentSignIn() {
    if (!client) throw new DeviceAccessError("unavailable");
    const { data, error } = await client.auth.getSession();
    if (error) throw new DeviceAccessError("unavailable");
    if (!data.session) throw new DeviceAccessError("reconnect");
    const sessionId = sessionIdFromToken(data.session.access_token);
    if (!sessionId) throw new DeviceAccessError("unavailable");
    return { userId: data.session.user.id, sessionId };
  }

  async function storedDevice(userId: string, sessionId: string) {
    const device = await store.load(userId).catch(() => null);
    return device?.sessionId === sessionId ? device : null;
  }

  async function register(userId: string, sessionId: string): Promise<MessagingDevice> {
    const { data, error } = await client!.rpc("messaging_register_device");
    if (error) {
      const code = errorCode(error);
      if (code === DEVICE_EXISTS || code === DUPLICATE_KEY) {
        // Another tab of this browser may have registered the same sign-in a moment ago.
        await wait(OTHER_TAB_DELAY_MS);
        const shared = await storedDevice(userId, sessionId);
        if (shared) return shared;
        throw new DeviceAccessError("reconnect");
      }
      throw new DeviceAccessError(RECONNECT_CODES.has(code) ? "reconnect" : "unavailable");
    }
    const result = data as { session_id?: unknown; key?: unknown; server_time?: unknown } | null;
    if (result?.session_id !== sessionId || typeof result.key !== "string" || typeof result.server_time !== "number") {
      throw new DeviceAccessError("unavailable");
    }
    const device = { userId, sessionId, key: await importDeviceKey(result.key), clockOffset: result.server_time - Date.now() };
    await store.save(device).catch(() => undefined);
    return device;
  }

  async function ensureDevice(): Promise<MessagingDevice> {
    const { userId, sessionId } = await currentSignIn();
    if (current?.userId === userId && current.sessionId === sessionId) return current;
    const stored = await storedDevice(userId, sessionId);
    if (stored) return (current = stored);
    if (registration?.sessionId !== sessionId) {
      const device = register(userId, sessionId);
      registration = { sessionId, device };
      device.catch(() => { if (registration?.device === device) registration = null; });
    }
    return (current = await registration.device);
  }

  async function prove(action: string, payload: string) {
    return createProof(await ensureDevice(), action, payload);
  }

  async function forget() {
    current = null;
    registration = null;
    await store.clear().catch(() => undefined);
  }

  return { ensureDevice, prove, forget };
}
