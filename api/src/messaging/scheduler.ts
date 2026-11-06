import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createRpcJobStore, notificationChannel, runNotificationRound, type NotificationChannel, type NotificationConfig } from "../notifications/delivery.js";
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

export async function registerNotificationSchedulerRoute(app: FastifyInstance, backend?: NotificationScheduler,
  roundLimit: RoundLimit = createRoundLimit()) {
  app.post("/messaging/notifications/run", { bodyLimit: 256 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    if (!token) return reply.code(401).send({ error: "Déclenchement non autorisé." });
    if (!backend) return reply.code(503).send({ error: "Les notifications sont momentanément indisponibles." });
    if (!backend.authorize(token)) return reply.code(401).send({ error: "Déclenchement non autorisé." });
    // There is no API for choosing a recipient, a message, or a provider payload.
    const body = request.body;
    if ((body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0))
      || Object.keys(request.query as object).length !== 0) return reply.code(400).send({ error: "Requête invalide." });
    // Only a valid trigger takes a round, so an impostor cannot use up the budget.
    const slot = roundLimit.take();
    if (!slot.allowed) {
      return reply.code(429).header("retry-after", String(slot.retryAfterSeconds))
        .send({ error: "Trop de déclenchements. Réessayez dans une minute." });
    }
    try {
      const result = await backend.run();
      const { claimed, delivered, failed } = result;
      if (![claimed, delivered, failed].every(count => Number.isInteger(count) && count >= 0 && count <= 5)
        || claimed !== delivered + failed) throw new Error("Invalid delivery counters");
      return { claimed, delivered, failed };
    } catch {
      return reply.code(503).send({ error: "Les notifications sont momentanément indisponibles." });
    }
  });
}
