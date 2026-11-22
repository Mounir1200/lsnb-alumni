import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";

test("the API reads its address, log level, allowed sites and Supabase access from the environment", () => {
  assert.deepEqual(loadConfig({
    API_HOST: " 127.0.0.1 ", PORT: "8080", LOG_LEVEL: " warn ", FRONTEND_ORIGINS: "https://site.example,https://hub.example",
    SUPABASE_URL: " https://project.supabase.co// ", SUPABASE_SECRET_KEY: " server-key ",
  }), {
    host: "127.0.0.1", port: 8080, logLevel: "warn", allowedOrigins: new Set(["https://site.example", "https://hub.example"]),
    highlightStorage: { url: "https://project.supabase.co", secretKey: "server-key" },
  });
});

test("without settings it listens everywhere on port 4000, logs at info and reaches no database", () => {
  assert.deepEqual(loadConfig({}), { host: "0.0.0.0", port: 4000, logLevel: "info", allowedOrigins: new Set() });
  for (const PORT of ["0", "65536", "port", "-1"]) assert.equal(loadConfig({ PORT }).port, 4000, PORT);
  assert.equal(loadConfig({ PORT: "65535" }).port, 65_535);
  assert.equal(loadConfig({ PORT: "1" }).port, 1);
  assert.equal(loadConfig({ SUPABASE_URL: "https://project.supabase.co" }).highlightStorage, undefined);
  assert.equal(loadConfig({ SUPABASE_SECRET_KEY: "server-key" }).highlightStorage, undefined);
});
