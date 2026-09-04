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
