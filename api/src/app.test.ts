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
