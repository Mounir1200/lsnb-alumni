import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config });

async function shutdown(signal: NodeJS.Signals) {
  app.operationsLog.record("info", "api.stopping");
  await app.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.operationsLog.record("info", "api.listening");
} catch {
  app.operationsLog.record("error", "api.start_failed");
  app.log.error("Unable to start API");
  process.exitCode = 1;
}
