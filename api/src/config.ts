const DEFAULT_PORT = 4000;

export type ApiConfig = {
  host: string;
  port: number;
  logLevel: string;
  allowedOrigins: ReadonlySet<string>;
  highlightStorage?: { url: string; secretKey: string };
};

function parsePort(value = "") {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

/** The sites allowed to call the API from a browser. None by default: a forgotten variable must not open it to localhost. */
function parseOrigins(value = "") {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(origins);
}

/** The web server refuses to start without them (the weekly job needs none). */
export function requireAllowedOrigins(config: ApiConfig): ApiConfig {
  if (config.allowedOrigins.size === 0) {
    throw new Error("FRONTEND_ORIGINS must list the sites allowed to call the API, separated by commas.");
  }
  return config;
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
