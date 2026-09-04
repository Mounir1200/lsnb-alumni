import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyServerOptions } from "fastify";
import { loadConfig, type ApiConfig } from "./config.js";

type BuildAppOptions = {
  config?: ApiConfig;
  logger?: FastifyServerOptions["logger"];
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

  return app;
}
