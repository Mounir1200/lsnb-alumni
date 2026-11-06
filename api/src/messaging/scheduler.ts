import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createRpcJobStore, notificationChannel, ROUND_CAPACITY, runNotificationRound, type NotificationChannel, type NotificationConfig } from "../notifications/delivery.js";
import { createRequestNotificationSender, REQUEST_QUEUE_RPCS, type RequestNotificationJob } from "../requests/notifications.js";
import { createNotificationSender, createNotificationStore, loadNotificationConfig } from "./notifications.js";
import { createRoundLimit, type RoundLimit } from "./roundLimit.js";

type DeliveryCounts = { claimed: number; delivered: number; failed: number };
export type NotificationScheduler = {
  authorize(token: string): boolean;
  run(): Promise<DeliveryCounts>;
};

/** The runner receives a narrowly scoped trigger credential, never a database key. */
export function createNotificationScheduler(apiKey: string, run: () => Promise<DeliveryCounts>): NotificationScheduler {
  if (!apiKey.trim()) throw new Error("Messaging scheduler is not configured");
  const expected = createHmac("sha256", apiKey.trim()).update("lsnb-messaging-scheduler-v1").digest();
  return {
    authorize(token) {
      // Validate the public encoding/length before comparing fixed-size bytes.
      return /^[a-f0-9]{64}$/i.test(token) && timingSafeEqual(Buffer.from(token, "hex"), expected);
    },
    run,
  };
}

/** Unread-message alerts first, then request emails, within one round's capacity. */
export function notificationChannels(config: NotificationConfig): NotificationChannel[] {
  return [
    notificationChannel(createNotificationStore(config), createNotificationSender(config)),
    notificationChannel(createRpcJobStore<RequestNotificationJob>(config, REQUEST_QUEUE_RPCS), createRequestNotificationSender(config)),
  ];
}

export function configuredNotificationScheduler(env: NodeJS.ProcessEnv = process.env): NotificationScheduler | undefined {
  if (env.MESSAGING_EMAIL_ENABLED !== "true") return undefined;
  const config = loadNotificationConfig(env);
  return createNotificationScheduler(config.apiKey, () => runNotificationRound(notificationChannels(config)));
}

const UNAUTHORIZED = { error: "Déclenchement non autorisé." };
const UNAVAILABLE = { error: "Les notifications sont momentanément indisponibles." };

function bearerToken(authorization: string | undefined) {
  return authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
}

/** There is no API for choosing a recipient, a message, or a provider payload. */
function isEmptyTrigger(body: unknown, query: object) {
  const isEmptyBody = body === undefined
    || (body !== null && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0);
  return isEmptyBody && Object.keys(query).length === 0;
}

/** A round claims at most its capacity, and each claimed job is either delivered or failed. */
function isRoundResult({ claimed, delivered, failed }: DeliveryCounts) {
  return [claimed, delivered, failed].every((count) => Number.isInteger(count) && count >= 0 && count <= ROUND_CAPACITY)
    && claimed === delivered + failed;
}

/** Only the counters leave the API, never what the round returned besides them. */
async function runRound(backend: NotificationScheduler): Promise<DeliveryCounts> {
  const { claimed, delivered, failed } = await backend.run();
  if (!isRoundResult({ claimed, delivered, failed })) throw new Error("Invalid delivery counters");
  return { claimed, delivered, failed };
}

export async function registerNotificationSchedulerRoute(app: FastifyInstance, backend?: NotificationScheduler,
  roundLimit: RoundLimit = createRoundLimit()) {
  app.post("/messaging/notifications/run", { bodyLimit: 256 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send(UNAUTHORIZED);
    if (!backend) return reply.code(503).send(UNAVAILABLE);
    if (!backend.authorize(token)) return reply.code(401).send(UNAUTHORIZED);
    if (!isEmptyTrigger(request.body, request.query as object)) return reply.code(400).send({ error: "Requête invalide." });
    // Only a valid trigger takes a round, so an impostor cannot use up the budget.
    const slot = roundLimit.take();
    if (!slot.allowed) {
      return reply.code(429).header("retry-after", String(slot.retryAfterSeconds))
        .send({ error: "Trop de déclenchements. Réessayez dans une minute." });
    }
    try {
      return await runRound(backend);
    } catch {
      return reply.code(503).send(UNAVAILABLE);
    }
  });
}
