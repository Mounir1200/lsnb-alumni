import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { LogController, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { randomUUID } from "node:crypto";
import { createAdminBackend, effectiveSiteStatus, type AdminBackend } from "./admin/backend.js";
import { createOperationalLog, type OperationalLog } from "./admin/logs.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { loadConfig, type ApiConfig } from "./config.js";
import { createHighlightStore } from "./highlights/store.js";
import type { HighlightStore } from "./highlights/types.js";
import { currentWeekStart } from "./highlights/week.js";
import { keepFor, PUBLIC_READ_TTL_MS } from "./keepFor.js";
import { registerRequestLimits } from "./requestLimits.js";
import { configuredNotificationScheduler, registerNotificationSchedulerRoute, type NotificationScheduler } from "./messaging/scheduler.js";

type BuildAppOptions = {
  config?: ApiConfig;
  logger?: FastifyServerOptions["logger"];
  highlightStore?: Pick<HighlightStore, "current">;
  now?: () => Date;
  adminBackend?: AdminBackend;
  notificationScheduler?: NotificationScheduler;
};

const healthSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["status", "service"],
      properties: {
        status: { type: "string" },
        service: { type: "string" },
      },
    },
  },
} as const;

function errorMessage(status: number) {
  if (status >= 500) return "Le serveur est momentanément indisponible.";
  return status === 429 ? "Trop de requêtes. Réessayez dans une minute." : "Requête invalide.";
}

/** The site status changes rarely and is read by every public route: it is remembered too. Access checks never are. */
function withRememberedStatus(backend: AdminBackend | undefined, now: () => number): AdminBackend | undefined {
  if (!backend) return undefined;
  const siteStatus = keepFor(() => backend.siteStatus(), PUBLIC_READ_TTL_MS, now);
  return { authorize: (token) => backend.authorize(token), siteStatus: () => siteStatus(undefined) };
}

const LOGGED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const QUIET_ROUTES = ["/health", "/api/v1/admin/logs", "/api/v1/site-status"];

/**
 * Default Fastify request/error logging includes URLs or errors. Only allowlisted metadata
 * is recorded here; unknown paths and all query strings remain private.
 */
function recordRequest(log: OperationalLog, request: FastifyRequest, reply: FastifyReply) {
  const path = request.routeOptions.url;
  if (reply.statusCode < 400 && QUIET_ROUTES.includes(path ?? "")) return;
  log.record(reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warn" : "info", "api.request", {
    method: LOGGED_METHODS.includes(request.method) ? request.method : "OTHER",
    path: path ?? "unmatched", status: reply.statusCode,
    duration_ms: reply.elapsedTime, request_id: request.id,
  });
}

/** A client mistake keeps its 4xx status; anything else is a 500 that tells nothing about its cause. */
function replyWithError(log: OperationalLog, error: unknown, reply: FastifyReply) {
  const suggested = (error as { statusCode?: number }).statusCode;
  const status = suggested && suggested >= 400 && suggested < 500 ? suggested : 500;
  if (status === 500) log.record("error", "api.unhandled_error");
  reply.header("cache-control", "no-store").code(status).send({ error: errorMessage(status) });
}

/** Missing server-only secrets leave the notification trigger disabled. */
function notificationSchedulerFrom(options: BuildAppOptions) {
  if (options.notificationScheduler) return options.notificationScheduler;
  try { return configuredNotificationScheduler(); } catch { return undefined; }
}

/**
 * What the public routes read, from a ten-second memory: however many visitors ask,
 * Supabase is read once per period.
 */
function publicReads(options: BuildAppOptions, config: ApiConfig, now: () => Date) {
  const storage = config.highlightStorage;
  const highlightStore = options.highlightStore ?? (storage ? createHighlightStore(storage) : undefined);
  const nowMs = () => now().getTime();
  return {
    currentHighlight: highlightStore && keepFor((week: string) => highlightStore.current(week), PUBLIC_READ_TTL_MS, nowMs),
    adminBackend: withRememberedStatus(options.adminBackend ?? (storage ? createAdminBackend(storage) : undefined), nowMs),
  };
}

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: true,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });
  const now = options.now ?? (() => new Date());
  app.decorate("operationsLog", createOperationalLog(now));
  app.addHook("onResponse", async (request, reply) => recordRequest(app.operationsLog, request, reply));
  app.setNotFoundHandler(async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return reply.code(404).send({ error: "Ressource introuvable." });
  });
  app.setErrorHandler((error, _request, reply) => replyWithError(app.operationsLog, error, reply));
  app.addHook("onReady", async () => { app.operationsLog.record("info", "api.ready"); });
  app.addHook("onClose", async () => { app.operationsLog.record("info", "api.stopped"); });

  await app.register(helmet);
  await registerRequestLimits(app);
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      const isAllowed = !origin || config.allowedOrigins.has(origin);
      callback(null, isAllowed);
    },
  });

  // Render polls it to know the API is up: a limit there would get a busy API restarted.
  app.get("/health", { schema: healthSchema, config: { rateLimit: false } }, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { status: "ok", service: "lsnb-alumni-api" };
  });

  app.get("/api/v1", async () => ({
    name: "LSNB Alumni API",
    version: "v1",
  }));

  const { currentHighlight, adminBackend } = publicReads(options, config, now);
  await registerAdminRoutes(app, adminBackend, now);
  await registerNotificationSchedulerRoute(app, notificationSchedulerFrom(options));

  app.get("/api/v1/highlights/current", async (request, reply) => {
    // Texts are persisted in Postgres. No browser/CDN cache can prolong a withdrawn profile.
    reply.header("cache-control", "no-store");
    if (adminBackend) {
      try {
        const status = effectiveSiteStatus(await adminBackend.siteStatus());
        if (status.active) {
          app.operationsLog.record("info", "maintenance.blocked");
          if (status.ends_at) reply.header("retry-after", Math.max(1, Math.ceil((Date.parse(status.ends_at) - Date.parse(status.server_time)) / 1000)));
          return reply.code(503).send({ code: "maintenance", error: "Le réseau est temporairement en maintenance.", maintenance: status });
        }
      } catch {
        app.operationsLog.record("error", "control.unavailable");
        return reply.code(503).send({ error: "Le statut du site est momentanément indisponible." });
      }
    }
    if (!currentHighlight) return { highlight: null };
    try {
      return { highlight: await currentHighlight(currentWeekStart(options.now?.())) };
    } catch {
      app.operationsLog.record("error", "highlights.unavailable");
      return reply.code(503).send({ error: "Les Highlights sont momentanément indisponibles." });
    }
  });

  return app;
}
