import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import { randomUUID } from "node:crypto";
import { createAdminBackend, effectiveSiteStatus, type AdminBackend } from "./admin/backend.js";
import { createOperationalLog } from "./admin/logs.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { loadConfig, type ApiConfig } from "./config.js";
import { createHighlightStore } from "./highlights/store.js";
import type { HighlightStore } from "./highlights/types.js";
import { currentWeekStart } from "./highlights/week.js";
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
  // Default Fastify request/error logging includes URLs or errors. Only allowlisted metadata
  // is recorded here; unknown paths and all query strings remain private.
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 400 && ["/health", "/api/v1/admin/logs", "/api/v1/site-status"].includes(request.routeOptions.url ?? "")) return;
    app.operationsLog.record(reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warn" : "info", "api.request", {
      method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method) ? request.method : "OTHER",
      path: request.routeOptions.url ?? "unmatched", status: reply.statusCode,
      duration_ms: reply.elapsedTime, request_id: request.id,
    });
  });
  app.setNotFoundHandler(async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return reply.code(404).send({ error: "Ressource introuvable." });
  });
  app.setErrorHandler((error, _request, reply) => {
    const suggested = (error as { statusCode?: number }).statusCode;
    const status = suggested && suggested >= 400 && suggested < 500 ? suggested : 500;
    if (status === 500) app.operationsLog.record("error", "api.unhandled_error");
    reply.header("cache-control", "no-store").code(status).send({ error: status >= 500 ? "Le serveur est momentanément indisponible." : "Requête invalide." });
  });
  app.addHook("onReady", async () => { app.operationsLog.record("info", "api.ready"); });
  app.addHook("onClose", async () => { app.operationsLog.record("info", "api.stopped"); });

  await app.register(helmet);
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      const isAllowed = !origin || config.allowedOrigins.has(origin);
      callback(null, isAllowed);
    },
  });

  app.get("/health", { schema: healthSchema }, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { status: "ok", service: "lsnb-alumni-api" };
  });

  app.get("/api/v1", async () => ({
    name: "LSNB Alumni API",
    version: "v1",
  }));

  const highlightStore = options.highlightStore ?? (config.highlightStorage
    ? createHighlightStore(config.highlightStorage)
    : undefined);
  const adminBackend = options.adminBackend ?? (config.highlightStorage ? createAdminBackend(config.highlightStorage) : undefined);
  await registerAdminRoutes(app, adminBackend, now);
  let notificationScheduler = options.notificationScheduler;
  if (!notificationScheduler) {
    try { notificationScheduler = configuredNotificationScheduler(); }
    catch { /* Missing server-only secrets leave the trigger disabled. */ }
  }
  await registerNotificationSchedulerRoute(app, notificationScheduler);

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
    if (!highlightStore) return { highlight: null };
    try {
      return { highlight: await highlightStore.current(currentWeekStart(options.now?.())) };
    } catch {
      app.operationsLog.record("error", "highlights.unavailable");
      return reply.code(503).send({ error: "Les Highlights sont momentanément indisponibles." });
    }
  });

  return app;
}
