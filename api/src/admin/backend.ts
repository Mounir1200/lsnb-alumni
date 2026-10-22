export type SiteStatus = {
  enabled: boolean;
  active: boolean;
  message: string;
  ends_at: string | null;
  started_at: string | null;
  server_time: string;
};

export type AdminBackend = {
  authorize: (accessToken: string) => Promise<void>;
  siteStatus: () => Promise<SiteStatus>;
};

/** Carries only safe local metadata, never the upstream error payload. */
export class ControlPlaneError extends Error {
  constructor(readonly status: 401 | 403 | 503) {
    super("Control plane request failed");
    this.name = "ControlPlaneError";
  }
}

export function inactiveSiteStatus(now = new Date()): SiteStatus {
  return {
    enabled: false, active: false, message: "", ends_at: null, started_at: null,
    server_time: now.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Use the database clock for expiration, so deployment clock skew cannot extend a pause. */
export function effectiveSiteStatus(value: unknown): SiteStatus {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || typeof value.active !== "boolean" ||
    typeof value.message !== "string" || value.message.length > 2000 || !isTimestamp(value.server_time) ||
    (value.ends_at !== null && !isTimestamp(value.ends_at)) ||
    (value.started_at !== null && !isTimestamp(value.started_at))) {
    throw new ControlPlaneError(503);
  }
  return {
    enabled: value.enabled,
    active: value.enabled && value.active && (value.ends_at === null || Date.parse(value.ends_at) > Date.parse(value.server_time)),
    message: value.message,
    ends_at: value.ends_at as string | null,
    started_at: value.started_at as string | null,
    server_time: value.server_time,
  };
}

export function createAdminBackend(
  config: { url: string; secretKey: string },
  fetchImpl: typeof fetch = fetch,
): AdminBackend {
  const baseUrl = config.url.replace(/\/+$/, "");
  async function request(path: string, accessToken?: string): Promise<unknown> {
    const headers: Record<string, string> = { apikey: config.secretKey };
    // User-context calls MUST use the user's JWT, including with a server-side apikey.
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    else if (config.secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${config.secretKey}`;
    const isRpc = path.startsWith("/rest/v1/rpc/");
    if (isRpc) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: isRpc ? "POST" : "GET", headers,
        ...(isRpc ? { body: "{}" } : {}),
        signal: AbortSignal.timeout(5_000), redirect: "error",
      });
    } catch {
      throw new ControlPlaneError(503);
    }
    if (!response.ok) {
      const denied = accessToken && (response.status === 401 || response.status === 403);
      throw new ControlPlaneError(denied ? (path === "/auth/v1/user" ? 401 : 403) : 503);
    }
    try { return await response.json() as unknown; }
    catch { throw new ControlPlaneError(503); }
  }

  return {
    async authorize(accessToken) {
      // Validate with Auth on every request. No decoded JWT or user_metadata is trusted.
      const user = await request("/auth/v1/user", accessToken);
      if (!isRecord(user) || typeof user.id !== "string" || !user.id) throw new ControlPlaneError(401);
      const context = await request("/rest/v1/rpc/hub_context", accessToken);
      // Read the live, database-owned role on every request so revocations take effect immediately.
      if (!isRecord(context) || context.user_id !== user.id || context.role !== "admin") {
        throw new ControlPlaneError(403);
      }
    },
    async siteStatus() {
      return effectiveSiteStatus(await request("/rest/v1/rpc/public_site_status"));
    },
  };
}
