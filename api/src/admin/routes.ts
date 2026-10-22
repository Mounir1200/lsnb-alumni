import type { FastifyInstance } from "fastify";
import { ControlPlaneError, effectiveSiteStatus, inactiveSiteStatus, type AdminBackend } from "./backend.js";
import type { OperationalLog, LogLevel } from "./logs.js";

declare module "fastify" {
  interface FastifyInstance { operationsLog: OperationalLog }
}

export async function registerAdminRoutes(app: FastifyInstance, backend: AdminBackend | undefined, now: () => Date) {
  app.get("/api/v1/site-status", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    if (!backend) return inactiveSiteStatus(now());
    try { return effectiveSiteStatus(await backend.siteStatus()); }
    catch {
      app.operationsLog.record("error", "control.unavailable");
      return reply.code(503).send({ error: "Le statut du site est momentanément indisponible." });
    }
  });

  app.get<{ Querystring: { level?: string; limit?: string } }>("/api/v1/admin/logs", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{1,8192})$/i)?.[1];
    if (!token) return reply.code(401).send({ error: "Authentification requise." });
    if (!backend) return reply.code(503).send({ error: "Le hub n’est pas encore configuré." });
    try { await backend.authorize(token); }
    catch (error) {
      const status = error instanceof ControlPlaneError ? error.status : 503;
      if (status === 503) app.operationsLog.record("error", "control.unavailable");
      return reply.code(status).send({ error: status === 401 ? "Session invalide ou expirée." :
        status === 403 ? "Accès réservé aux administrateurs." : "La vérification des accès est momentanément indisponible." });
    }
    const { level = "all", limit = "100" } = request.query;
    if (!["all", "info", "warn", "error"].includes(level) || !/^\d{1,3}$/.test(limit) ||
      Number(limit) < 1 || Number(limit) > 500 || Object.keys(request.query).some((key) => !["level", "limit"].includes(key))) {
      return reply.code(400).send({ error: "Filtres invalides : niveau all/info/warn/error et limite entre 1 et 500." });
    }
    return app.operationsLog.snapshot(level as LogLevel | "all", Number(limit));
  });
}
