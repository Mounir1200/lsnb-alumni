import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isIP } from "node:net";

export const REQUESTS_PER_MINUTE = 60;
/** Each server-log request asks Supabase Auth, then the database, who is calling. */
export const ADMIN_LOG_REQUESTS_PER_MINUTE = 20;
export const MINUTE_MS = 60_000;

/**
 * Who is asking: the address Cloudflare saw. Render sits behind Cloudflare and
 * only appends to X-Forwarded-For, so its first entry is whatever the client
 * wrote there; Cloudflare sets CF-Connecting-IP itself on every request.
 */
export function clientKey(request: FastifyRequest): string {
  const seen = request.headers["cf-connecting-ip"];
  return typeof seen === "string" && isIP(seen.trim()) !== 0 ? seen.trim() : request.ip;
}

/** Every route shares one budget per client, unless it sets its own (config.rateLimit). */
export async function registerRequestLimits(app: FastifyInstance) {
  await app.register(rateLimit, { max: REQUESTS_PER_MINUTE, timeWindow: MINUTE_MS, keyGenerator: clientKey });
}
