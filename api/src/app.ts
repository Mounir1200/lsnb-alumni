import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyServerOptions } from "fastify";
import { loadConfig, type ApiConfig } from "./config.js";
import { createHighlightStore } from "./highlights/store.js";
import type { HighlightStore } from "./highlights/types.js";
import { currentWeekStart } from "./highlights/week.js";

type BuildAppOptions = {
  config?: ApiConfig;
  logger?: FastifyServerOptions["logger"];
  highlightStore?: Pick<HighlightStore, "current">;
  now?: () => Date;
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
  });

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

  app.get("/api/v1/highlights/current", async (request, reply) => {
    // Texts are persisted in Postgres. No browser/CDN cache can prolong a withdrawn profile.
    reply.header("cache-control", "no-store");
    if (!highlightStore) return { highlight: null };
    try {
      return { highlight: await highlightStore.current(currentWeekStart(options.now?.())) };
    } catch {
      request.log.error("Unable to read the current Highlight edition");
      return reply.code(503).send({ error: "Les Highlights sont momentanément indisponibles." });
    }
  });

  return app;
}
