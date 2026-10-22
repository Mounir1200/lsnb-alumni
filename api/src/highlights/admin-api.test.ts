import assert from "node:assert/strict";
import test from "node:test";
import { Writable } from "node:stream";
import { buildApp } from "../app.js";
import { ControlPlaneError, createAdminBackend, inactiveSiteStatus, type AdminBackend, type SiteStatus } from "../admin/backend.js";
import { createOperationalLog } from "../admin/logs.js";
import type { ApiConfig } from "../config.js";

const config: ApiConfig = {
  host: "127.0.0.1", port: 4000, logLevel: "silent", allowedOrigins: new Set(["http://localhost:5173", "http://localhost:5174"]),
};
const now = () => new Date("2026-10-22T12:00:00Z");
const auth = { authorization: "Bearer trusted-token" };
const backend = (overrides: Partial<AdminBackend> = {}): AdminBackend => ({
  authorize: async (token) => { if (token !== "trusted-token") throw new ControlPlaneError(401); },
  siteStatus: async () => inactiveSiteStatus(now()),
  ...overrides,
});
const paused = (endsAt: string | null = null): SiteStatus => ({
  enabled: true, active: true, message: "Une mise à jour est en cours.",
  started_at: "2026-10-22T11:00:00Z", ends_at: endsAt, server_time: now().toISOString(),
});
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((url, init) => handler(String(url), init ?? {})) as typeof fetch;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("server logs reject anonymous and malformed authentication without contacting Auth", async (context) => {
  let calls = 0;
  const app = await buildApp({ config, logger: false, adminBackend: backend({ authorize: async () => { calls++; } }) });
  context.after(() => app.close());
  for (const headers of [{}, { authorization: "Basic trusted-token" }, { authorization: "Bearer" }, { authorization: "Bearer first second" }]) {
    const response = await app.inject({ url: "/api/v1/admin/logs", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal(calls, 0);
});

test("members and moderators cannot read server logs even with a valid session", async (context) => {
  const app = await buildApp({ config, logger: false, adminBackend: backend({ authorize: async () => { throw new ControlPlaneError(403); } }) });
  context.after(() => app.close());
  for (const token of ["member-session", "moderator-session"]) {
    assert.equal((await app.inject({ url: "/api/v1/admin/logs", headers: { authorization: `Bearer ${token}` } })).statusCode, 403);
  }
});

test("admins receive bounded safe operational events with truthful retention", async (context) => {
  const app = await buildApp({ config, logger: false, adminBackend: backend(), now });
  context.after(() => app.close());
  await app.inject("/does-not-exist");
  const response = await app.inject({ url: "/api/v1/admin/logs?level=all&limit=2", headers: auth });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const data = response.json();
  assert.equal(data.retention, "process");
  assert.equal(data.service, "lsnb-alumni-api");
  assert.equal(data.started_at, now().toISOString());
  assert.equal(data.entries.length, 2);
  assert.ok(data.entries.some((entry: { event: string }) => entry.event === "api.ready"));
  assert.ok(data.entries.some((entry: { path: string; status: number }) => entry.path === "unmatched" && entry.status === 404));
});

test("log filters reject invalid, repeated and unbounded values", async (context) => {
  const app = await buildApp({ config, logger: false, adminBackend: backend() });
  context.after(() => app.close());
  for (const query of ["limit=0", "limit=-1", "limit=501", "limit=9999999999999", "limit=NaN", "limit=1.5", "limit=1&limit=2", "level=debug", "level=info&level=error", "user_id=someone"]) {
    const response = await app.inject({ url: `/api/v1/admin/logs?${query}`, headers: auth });
    assert.equal(response.statusCode, 400, query);
  }
  const response = await app.inject({ url: "/api/v1/admin/logs?level=warn&limit=1", headers: auth });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().entries.length, 1);
  assert.equal(response.json().entries[0].level, "warn");
});

test("role revocation applies to the next request without restarting the API", async (context) => {
  let admin = true;
  const app = await buildApp({ config, logger: false, adminBackend: backend({ authorize: async () => { if (!admin) throw new ControlPlaneError(403); } }) });
  context.after(() => app.close());
  assert.equal((await app.inject({ url: "/api/v1/admin/logs", headers: auth })).statusCode, 200);
  admin = false;
  assert.equal((await app.inject({ url: "/api/v1/admin/logs", headers: auth })).statusCode, 403);
});

test("logs and default logger never contain secret paths, queries, headers, bodies or error stacks", async (context) => {
  let consoleOutput = "";
  const stream = new Writable({ write(chunk, _encoding, callback) { consoleOutput += String(chunk); callback(); } });
  const app = await buildApp({
    config, logger: { level: "info", stream }, adminBackend: backend(),
    highlightStore: { current: async () => { throw new Error("database_password_secret"); } },
  });
  app.get("/explode", async () => { throw new Error("error_stack_secret"); });
  context.after(() => app.close());
  await app.inject({ method: "POST", url: "/private_email_secret@example.test?token=query_token_secret", headers: {
    authorization: "Bearer request_token_secret", "x-request-id": "injected_request_id_secret",
  }, payload: { password: "body_password_secret" } });
  await app.inject("/api/v1/highlights/current?token=highlight_query_secret");
  const exploded = await app.inject("/explode?password=error_query_secret");
  assert.equal(exploded.statusCode, 500);
  const response = await app.inject({ url: "/api/v1/admin/logs", headers: auth });
  for (const secret of ["private_email_secret", "query_token_secret", "request_token_secret", "injected_request_id_secret", "body_password_secret", "database_password_secret", "highlight_query_secret", "error_stack_secret", "error_query_secret"]) {
    assert.equal((response.body + consoleOutput + exploded.body).includes(secret), false, secret);
  }
  assert.ok(response.json().entries.some((entry: { event: string }) => entry.event === "api.unhandled_error"));
  assert.ok(response.json().entries.some((entry: { event: string }) => entry.event === "highlights.unavailable"));
});

test("operational ring evicts old events and returns independent snapshots", () => {
  const logs = createOperationalLog(now, 3);
  for (let index = 0; index < 8; index++) logs.record("info", "api.request", { status: 200 + index });
  const first = logs.snapshot("all", 500);
  assert.deepEqual(first.entries.map((entry) => entry.status), [207, 206, 205]);
  first.entries[0]!.status = 500;
  assert.equal(logs.snapshot("all", 1).entries[0]!.status, 207);
});

test("maintenance blocks the public data route while health and admin remain available", async (context) => {
  let reads = 0;
  const app = await buildApp({
    config, logger: false, now, adminBackend: backend({ siteStatus: async () => paused("2026-10-22T12:10:00Z") }),
    highlightStore: { current: async () => { reads++; return null; } },
  });
  context.after(() => app.close());
  const response = await app.inject("/api/v1/highlights/current");
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, "maintenance");
  assert.equal(response.headers["retry-after"], "600");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(reads, 0);
  assert.equal((await app.inject("/health")).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/v1/admin/logs", headers: auth })).statusCode, 200);
  const status = await app.inject("/api/v1/site-status");
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().active, true);
  assert.equal(status.headers["cache-control"], "no-store");
});

test("expired or disabled maintenance immediately restores public data", async (context) => {
  let status = paused("2026-10-22T12:00:00Z");
  let reads = 0;
  const app = await buildApp({ config, logger: false, now,
    adminBackend: backend({ siteStatus: async () => status }),
    highlightStore: { current: async () => { reads++; return null; } },
  });
  context.after(() => app.close());
  assert.equal((await app.inject("/api/v1/highlights/current")).statusCode, 200);
  assert.equal((await app.inject("/api/v1/site-status")).json().active, false);
  status = { ...paused(null), enabled: false };
  assert.equal((await app.inject("/api/v1/highlights/current")).statusCode, 200);
  assert.equal(reads, 2);
});

test("indefinite maintenance has no fabricated retry date", async (context) => {
  const app = await buildApp({ config, logger: false, adminBackend: backend({ siteStatus: async () => paused() }) });
  context.after(() => app.close());
  const response = await app.inject("/api/v1/highlights/current");
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["retry-after"], undefined);
});

test("control outages fail closed without leaking upstream details", async (context) => {
  let reads = 0;
  const unavailable = async (): Promise<never> => { throw new Error("upstream_service_key_secret"); };
  const app = await buildApp({ config, logger: false,
    adminBackend: backend({ siteStatus: unavailable, authorize: unavailable }),
    highlightStore: { current: async () => { reads++; return null; } },
  });
  context.after(() => app.close());
  for (const url of ["/api/v1/site-status", "/api/v1/highlights/current", "/api/v1/admin/logs"]) {
    const response = await app.inject({ url, headers: auth });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.includes("upstream_service_key_secret"), false);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal(reads, 0);
});

test("invalid status data fails closed and an unconfigured demo still works", async (context) => {
  const configured = await buildApp({ config, logger: false, adminBackend: backend({ siteStatus: async () => ({ active: false } as SiteStatus) }) });
  const demo = await buildApp({ config, logger: false });
  context.after(() => Promise.all([configured.close(), demo.close()]));
  assert.equal((await configured.inject("/api/v1/highlights/current")).statusCode, 503);
  assert.equal((await demo.inject("/api/v1/highlights/current")).statusCode, 200);
  assert.equal((await demo.inject("/api/v1/site-status")).json().active, false);
  assert.equal((await demo.inject({ url: "/api/v1/admin/logs", headers: auth })).statusCode, 503);
});

test("Supabase authorization verifies Auth first and preserves user context for the role RPC", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const store = createAdminBackend({ url: "https://example.supabase.co", secretKey: "server_secret_key" }, fakeFetch((url, init) => {
    calls.push({ url, init });
    return json(url.endsWith("/auth/v1/user") ? { id: "trusted-user", user_metadata: { role: "admin" } } : { user_id: "trusted-user", role: "admin" });
  }));
  await store.authorize("user_access_token");
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.url.endsWith("/auth/v1/user"));
  assert.ok(calls[1]!.url.endsWith("/rest/v1/rpc/hub_context"));
  for (const call of calls) {
    assert.equal((call.init.headers as Record<string, string>).Authorization, "Bearer user_access_token");
    assert.equal((call.init.headers as Record<string, string>).apikey, "server_secret_key");
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal);
  }
  assert.equal(calls[1]!.init.body, "{}");
});

test("forged admin metadata, another user's context and moderator roles never authorize", async () => {
  for (const context of [null, { role: "admin" }, { role: "admin", user_id: "other-user" }, { role: "moderator", user_id: "trusted-user" }, { role: "member", user_id: "trusted-user" }]) {
    const store = createAdminBackend({ url: "https://example.supabase.co", secretKey: "secret" }, fakeFetch((url) =>
      json(url.endsWith("/auth/v1/user") ? { id: "trusted-user", user_metadata: { role: "admin" } } : context)));
    await assert.rejects(store.authorize("forged_claims"), (error: unknown) => error instanceof ControlPlaneError && error.status === 403);
  }
});

test("an invalid JWT cannot invoke the role RPC and upstream faults are normalized", async () => {
  let calls = 0;
  const store = createAdminBackend({ url: "https://example.supabase.co", secretKey: "secret" }, fakeFetch(() => {
    calls++; return json({ error: "token_secret" }, 401);
  }));
  await assert.rejects(store.authorize("invalid-token"), (error: unknown) => error instanceof ControlPlaneError && error.status === 401 && !error.message.includes("token_secret"));
  assert.equal(calls, 1);
  const unavailable = createAdminBackend({ url: "https://example.supabase.co", secretKey: "secret" }, fakeFetch(() => { throw new Error("network_secret"); }));
  await assert.rejects(unavailable.authorize("token"), (error: unknown) => error instanceof ControlPlaneError && error.status === 503 && !error.message.includes("network_secret"));
});

test("public status supports legacy and new server keys without passing user tokens", async () => {
  for (const secretKey of ["eyJ.legacy.service", "sb_secret_new"]) {
    const store = createAdminBackend({ url: "https://example.supabase.co/", secretKey }, fakeFetch((url, init) => {
      assert.equal(url, "https://example.supabase.co/rest/v1/rpc/public_site_status");
      assert.equal((init.headers as Record<string, string>).Authorization, secretKey.startsWith("eyJ") ? `Bearer ${secretKey}` : undefined);
      return json(paused("2026-10-22T11:59:00Z"));
    }));
    assert.equal((await store.siteStatus()).active, false);
  }
});
