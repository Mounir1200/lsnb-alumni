const DEFAULT_PORT = 4000;
const DEFAULT_ORIGIN = "http://localhost:5173";

export type ApiConfig = {
  host: string;
  port: number;
  logLevel: string;
  allowedOrigins: ReadonlySet<string>;
  highlightStorage?: { url: string; secretKey: string };
};

function parsePort(value: string | undefined) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

function parseOrigins(value: string | undefined) {
  const origins = (value ?? DEFAULT_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(origins);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const url = environment.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim();
  return {
    host: environment.API_HOST?.trim() || "0.0.0.0",
    port: parsePort(environment.PORT),
    logLevel: environment.LOG_LEVEL?.trim() || "info",
    allowedOrigins: parseOrigins(environment.FRONTEND_ORIGINS),
    ...(url && secretKey ? { highlightStorage: { url, secretKey } } : {}),
  };
}
