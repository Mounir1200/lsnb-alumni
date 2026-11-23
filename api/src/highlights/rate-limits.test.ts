import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../app.js";
import { ControlPlaneError, inactiveSiteStatus, type AdminBackend } from "../admin/backend.js";
import { loadConfig, type ApiConfig } from "../config.js";

const config: ApiConfig = { host: "127.0.0.1", port: 4000, logLevel: "silent", allowedOrigins: new Set(["http://localhost:5173"]) };
const fromVisitor = (ip: string, extra: Record<string, string> = {}) => ({ "cf-connecting-ip": ip, ...extra });

test("a client asking more than sixty times a minute is told to wait, others are not", async (context) => {
  const app = await buildApp({ config, logger: false });
  context.after(() => app.close());
  for (let call = 0; call < 60; call++) {
    assert.equal((await app.inject({ url: "/api/v1/site-status", headers: fromVisitor("203.0.113.7") })).statusCode, 200);
  }
  const refused = await app.inject({ url: "/api/v1/site-status", headers: fromVisitor("203.0.113.7") });
  assert.equal(refused.statusCode, 429);
  assert.match(refused.json().error, /Trop de requêtes/);
  assert.ok(Number(refused.headers["retry-after"]) > 0);
  assert.equal((await app.inject({ url: "/api/v1/site-status", headers: fromVisitor("198.51.100.4") })).statusCode, 200);
});

test("the client is the address Cloudflare saw, whatever X-Forwarded-For claims", async (context) => {
  const app = await buildApp({ config, logger: false });
  context.after(() => app.close());
  for (let call = 0; call <= 60; call++) {
    const response = await app.inject({ url: "/api/v1/highlights/current",
      headers: fromVisitor("203.0.113.7", { "x-forwarded-for": `10.0.${call}.1` }) });
    assert.equal(response.statusCode, call < 60 ? 200 : 429, `request ${call + 1}`);
  }
});

test("a CF-Connecting-IP that is not an address counts as the connection's own address", async (context) => {
  const app = await buildApp({ config, logger: false });
  context.after(() => app.close());
  for (let call = 0; call <= 60; call++) {
    const response = await app.inject({ url: "/api/v1/site-status", headers: { "cf-connecting-ip": `made-up-${call}` } });
    assert.equal(response.statusCode, call < 60 ? 200 : 429, `request ${call + 1}`);
  }
});

test("server logs allow twenty tries a minute, refused before Auth is asked", async (context) => {
  let authCalls = 0;
  const adminBackend: AdminBackend = {
    authorize: async () => { authCalls++; throw new ControlPlaneError(401); },
    siteStatus: async () => inactiveSiteStatus(new Date()),
  };
  const app = await buildApp({ config, logger: false, adminBackend });
  context.after(() => app.close());
  const headers = fromVisitor("203.0.113.9", { authorization: "Bearer guessed.token.value" });
  for (let call = 0; call < 20; call++) assert.equal((await app.inject({ url: "/api/v1/admin/logs", headers })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/v1/admin/logs", headers })).statusCode, 429);
  assert.equal(authCalls, 20);
});

test("the health check is never limited, so Render never restarts a busy API", async (context) => {
  const app = await buildApp({ config, logger: false });
  context.after(() => app.close());
  for (let call = 0; call < 80; call++) assert.equal((await app.inject({ url: "/health", headers: fromVisitor("203.0.113.7") })).statusCode, 200);
});

test("public reads reach Supabase at most once every ten seconds, and a failure is never kept", async (context) => {
  let time = Date.parse("2026-11-22T12:00:00Z");
  let statusReads = 0, highlightReads = 0, failNext = false;
  const app = await buildApp({ config, logger: false, now: () => new Date(time),
    adminBackend: {
      authorize: async () => undefined,
      siteStatus: async () => { statusReads++; if (failNext) { failNext = false; throw new Error("down"); } return inactiveSiteStatus(new Date(time)); },
    },
    highlightStore: { current: async () => { highlightReads++; return null; } },
  });
  context.after(() => app.close());
  for (const url of ["/api/v1/site-status", "/api/v1/highlights/current", "/api/v1/highlights/current", "/api/v1/site-status"]) {
    assert.equal((await app.inject({ url, headers: fromVisitor(`192.0.2.${statusReads}`) })).statusCode, 200);
  }
  assert.deepEqual([statusReads, highlightReads], [1, 1]);
  time += 10_000;
  failNext = true;
  assert.equal((await app.inject("/api/v1/site-status")).statusCode, 503);
  assert.equal((await app.inject("/api/v1/site-status")).statusCode, 200);
  assert.equal((await app.inject("/api/v1/highlights/current")).statusCode, 200);
  assert.deepEqual([statusReads, highlightReads], [3, 2]);
});

test("the server names the sites allowed to call it, with no fallback", () => {
  assert.deepEqual([...loadConfig({}).allowedOrigins], []);
  assert.deepEqual([...loadConfig({ FRONTEND_ORIGINS: " https://a.example , https://b.example " }).allowedOrigins],
    ["https://a.example", "https://b.example"]);
});

test("the web server will not start without the sites allowed to call it", async () => {
  const { requireAllowedOrigins } = await import("../config.js");
  assert.throws(() => requireAllowedOrigins(loadConfig({})), /FRONTEND_ORIGINS/);
  assert.equal(requireAllowedOrigins(loadConfig({ FRONTEND_ORIGINS: "https://a.example" })).allowedOrigins.size, 1);
});
