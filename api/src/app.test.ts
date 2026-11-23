import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.js";
import type { ApiConfig } from "./config.js";

const testConfig: ApiConfig = {
  host: "127.0.0.1",
  port: 4000,
  logLevel: "silent",
  allowedOrigins: new Set(["http://localhost:5173"]),
};

test("GET /health reports a healthy API", async (context) => {
  const app = await buildApp({ config: testConfig, logger: false });
  context.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "lsnb-alumni-api",
  });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("public Highlights are read-only and absent before configuration", async (context) => {
  const app = await buildApp({ config: testConfig, logger: false });
  context.after(() => app.close());
  const response = await app.inject("/api/v1/highlights/current");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { highlight: null });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/highlights/current" })).statusCode, 404);
});

test("anonymous public read uses the current Burkina week and never generates", async (context) => {
  const weeks: string[] = [];
  let now = new Date("2026-09-06T23:59:59Z");
  const app = await buildApp({
    config: testConfig, logger: false, now: () => now,
    highlightStore: { current: async (week) => { weeks.push(week); return null; } },
  });
  context.after(() => app.close());
  assert.equal((await app.inject("/api/v1/highlights/current")).statusCode, 200);
  now = new Date("2026-09-07T00:00:00Z");
  await app.inject("/api/v1/highlights/current");
  assert.deepEqual(weeks, ["2026-08-31", "2026-09-07"]);
});

test("storage outages return a safe retriable error", async (context) => {
  const app = await buildApp({
    config: testConfig, logger: false,
    highlightStore: { current: async () => { throw new Error("secret upstream detail"); } },
  });
  context.after(() => app.close());
  const response = await app.inject("/api/v1/highlights/current");
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes("secret"), false);
  assert.equal(response.headers["cache-control"], "no-store");
});

test("an unexpected failure answers 500 without its cause and is logged as an error; a client mistake keeps its 4xx", async (context) => {
  const app = await buildApp({ config: testConfig, logger: false });
  context.after(() => app.close());
  app.get("/unexpected", async () => { throw new Error("database password in the message"); });
  app.get("/conflict", async () => { throw Object.assign(new Error("conflict"), { statusCode: 409 }); });
  app.get("/odd-status", async () => { throw Object.assign(new Error("odd"), { statusCode: 600 }); });
  app.get("/redirect-status", async () => { throw Object.assign(new Error("redirect"), { statusCode: 302 }); });
  app.get("/boundary", async () => { throw Object.assign(new Error("boundary"), { statusCode: 400 }); });
  app.get("/just-below", async () => { throw Object.assign(new Error("just below"), { statusCode: 499 }); });
  app.get("/not-client", async () => { throw Object.assign(new Error("not client"), { statusCode: 500 }); });

  const failure = await app.inject("/unexpected");
  assert.equal(failure.statusCode, 500);
  assert.deepEqual(failure.json(), { error: "Le serveur est momentanément indisponible." });
  for (const [url, status] of [["/conflict", 409], ["/boundary", 400], ["/just-below", 499], ["/odd-status", 500], ["/redirect-status", 500], ["/not-client", 500]] as const) {
    assert.equal((await app.inject(url)).statusCode, status, url);
  }
  assert.deepEqual((await app.inject("/conflict")).json(), { error: "Requête invalide." });
  const entries = app.operationsLog.snapshot("all", 100).entries as { level: string; event: string; status?: number; path?: string }[];
  const requests = entries.filter((entry) => entry.event === "api.request");
  assert.equal(requests.find((entry) => entry.path === "/unexpected")?.level, "error");
  assert.equal(requests.find((entry) => entry.path === "/conflict")?.level, "warn");
  assert.ok(entries.some((entry) => entry.event === "api.unhandled_error"));
});
