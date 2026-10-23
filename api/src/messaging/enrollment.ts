import { createHash, randomInt, randomUUID, webcrypto } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildMessagingActivationEmail } from "./emailTemplate.js";
import type { NotificationConfig } from "./notifications.js";

type Vault = { v: 1; alg: "A256GCM"; iv: string; ct: string };
type Enrollment = { challengeId: string; code: string; publicKey: string; encryptedPrivateKey: Vault };
export type EnrollmentBackend = {
  start(token: string): Promise<{ challengeId: string; expiresAt: string }>;
  complete(token: string, enrollment: Enrollment): Promise<void>;
};
export class EnrollmentError extends Error {
  constructor(readonly status: number) { super("Messaging activation failed"); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const enrollmentCodeHash = (id: string, code: string) => createHash("sha256").update(`lsnb-enrollment-v1:${id}:${code}`).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

async function validateEnrollment(value: unknown): Promise<Enrollment> {
  if (!record(value) || Object.keys(value).sort().join() !== "challengeId,code,encryptedPrivateKey,publicKey"
    || typeof value.challengeId !== "string" || !uuid.test(value.challengeId)
    || typeof value.code !== "string" || !/^\d{8}$/.test(value.code)
    || typeof value.publicKey !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(value.publicKey)) throw new EnrollmentError(400);
  const vault = value.encryptedPrivateKey;
  if (!record(vault) || Object.keys(vault).sort().join() !== "alg,ct,iv,v" || vault.v !== 1 || vault.alg !== "A256GCM"
    || typeof vault.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(vault.iv)
    || typeof vault.ct !== "string" || !/^[A-Za-z0-9_-]{40,4096}$/.test(vault.ct)) throw new EnrollmentError(400);
  try {
    const raw = Buffer.from(value.publicKey, "base64url");
    if (raw.length !== 65 || raw[0] !== 4 || raw.toString("base64url") !== value.publicKey) throw new Error();
    await webcrypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch { throw new EnrollmentError(400); }
  return value as unknown as Enrollment;
}

export function createEnrollmentBackend(config: NotificationConfig, fetchImpl: typeof fetch = fetch): EnrollmentBackend {
  async function request(path: string, body?: unknown, token?: string): Promise<unknown> {
    const headers: Record<string, string> = { apikey: config.secretKey, "content-type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (config.secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${config.secretKey}`;
    let response: Response;
    try { response = await fetchImpl(`${config.supabaseUrl}${path}`, { method: body === undefined ? "GET" : "POST",
      headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000), redirect: "error" }); }
    catch { throw new EnrollmentError(503); }
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (token && [401,403].includes(response.status)) throw new EnrollmentError(401);
      const code = record(result) ? result.code : "";
      throw new EnrollmentError(code === "54000" ? 429 : code === "23505" ? 409 : code === "42501" ? 403 : code === "22023" ? 400 : 503);
    }
    return result;
  }
  async function actor(token: string) {
    const user = await request("/auth/v1/user", undefined, token);
    if (!record(user) || typeof user.id !== "string" || !uuid.test(user.id)
      || typeof user.email !== "string" || !user.email_confirmed_at) throw new EnrollmentError(401);
    // RLS eligibility (suspension, maintenance, completed profile) is checked again in SQL.
    return { id: user.id, email: user.email };
  }
  return {
    async start(token) {
      const user = await actor(token);
      const challengeId = randomUUID();
      const code = String(randomInt(0,100_000_000)).padStart(8,"0");
      const expiresAt = await request("/rest/v1/rpc/messaging_begin_identity_enrollment", {
        p_user_id: user.id, p_challenge_id: challengeId, p_code_hash: enrollmentCodeHash(challengeId,code), p_email: user.email,
      });
      const content = buildMessagingActivationEmail(code);
      let delivery: Response;
      try { delivery = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST", headers: { "api-key": config.apiKey, "content-type": "application/json", idempotencyKey: challengeId },
        body: JSON.stringify({ sender: { name: "LSNB Alumni", email: config.fromEmail }, to: [{ email: user.email }],
          subject: content.subject, textContent: content.text, htmlContent: content.html, headers: { idempotencyKey: challengeId } }),
        signal: AbortSignal.timeout(15_000), redirect: "error",
      }); } catch { throw new EnrollmentError(503); }
      if (!delivery.ok || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) throw new EnrollmentError(503);
      return { challengeId, expiresAt };
    },
    async complete(token, input) {
      const enrollment = await validateEnrollment(input);
      const user = await actor(token);
      const accepted = await request("/rest/v1/rpc/messaging_complete_identity_enrollment", {
        p_user_id: user.id, p_challenge_id: enrollment.challengeId, p_code_hash: enrollmentCodeHash(enrollment.challengeId,enrollment.code),
        p_public_key: enrollment.publicKey, p_encrypted_private_key: enrollment.encryptedPrivateKey,
      });
      if (accepted !== true) throw new EnrollmentError(400);
    },
  };
}

export async function registerEnrollmentRoutes(app: FastifyInstance, backend?: EnrollmentBackend) {
  for (const [path, start] of [["/messaging/identity/challenge",true],["/messaging/identity",false]] as const) {
    app.post(path, { bodyLimit: 8192 }, async (request, reply) => {
      reply.header("cache-control","no-store");
      const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{1,8192})$/i)?.[1];
      if (!token) return reply.code(401).send({ error: "Connectez-vous pour activer votre messagerie." });
      if (!backend) return reply.code(503).send({ error: "L’activation de la messagerie est momentanément indisponible." });
      try {
        if (start) {
          if (!record(request.body) || Object.keys(request.body).length) throw new EnrollmentError(400);
          return await backend.start(token);
        }
        await backend.complete(token,await validateEnrollment(request.body));
        return { registered: true };
      } catch (error) {
        const status = error instanceof EnrollmentError ? error.status : 503;
        return reply.code(status).send({ error: status === 429 ? "Patientez avant de demander un nouveau code." :
          status === 400 ? "Le code est incorrect, expiré ou les données d’activation sont invalides." :
          status === 401 ? "Votre session a expiré. Reconnectez-vous." :
          status === 409 ? "Une clé de messagerie est déjà enregistrée pour ce compte." :
          status === 403 ? "L’activation n’est pas disponible pour ce compte actuellement." :
          "L’activation de la messagerie est momentanément indisponible. Réessayez." });
      }
    });
  }
}
