export type NotificationConfig = {
  supabaseUrl: string;
  secretKey: string;
  apiKey: string;
  fromEmail: string;
  siteUrl: string;
};

// Errors intentionally exclude upstream bodies, addresses, message text and keys.
export class NotificationError extends Error {
  constructor(readonly stage: "configuration" | "storage" | "delivery", readonly status = 0) {
    super(`Messaging notification ${stage} failed (${status}).`);
    this.name = "NotificationError";
  }
}

export const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every scheduled round sends at most this many emails: five fit in one five-minute lease. */
export const ROUND_CAPACITY = 5;

export function loadNotificationConfig(env: NodeJS.ProcessEnv = process.env): NotificationConfig {
  const apiKey = env.BREVO_API_KEY?.trim();
  const fromEmail = env.MESSAGING_FROM_EMAIL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  let siteUrl: URL;
  let supabaseUrl: URL;
  try {
    siteUrl = new URL(env.MESSAGING_SITE_URL ?? "");
    supabaseUrl = new URL(env.SUPABASE_URL ?? "");
  } catch { throw new NotificationError("configuration"); }
  if (!apiKey || !secretKey || !fromEmail || !emailPattern.test(fromEmail)
    || siteUrl.protocol !== "https:" || supabaseUrl.protocol !== "https:"
    || siteUrl.username || siteUrl.password || supabaseUrl.username || supabaseUrl.password
    || siteUrl.search || siteUrl.hash || siteUrl.pathname !== "/"
    || supabaseUrl.search || supabaseUrl.hash || supabaseUrl.pathname !== "/") {
    throw new NotificationError("configuration");
  }
  return { apiKey, fromEmail, secretKey, siteUrl: siteUrl.origin, supabaseUrl: supabaseUrl.origin };
}

/** Calls a service-role RPC; the secret key only ever goes to Supabase. */
export function createServiceRpc(config: Pick<NotificationConfig, "supabaseUrl" | "secretKey">, fetchImpl: typeof fetch = fetch) {
  return async function rpc<T>(name: string, body: object): Promise<T> {
    const headers: Record<string, string> = { apikey: config.secretKey, "content-type": "application/json" };
    if (config.secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${config.secretKey}`;
    let response: Response;
    try {
      response = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new NotificationError("storage", 503); }
    if (!response.ok) throw new NotificationError("storage", response.status);
    const text = await response.text();
    if (!text) return undefined as T;
    try { return JSON.parse(text) as T; } catch { throw new NotificationError("storage", 502); }
  };
}

export type OutgoingEmail = { to: string; subject: string; text: string; html: string; idempotencyKey: string };

/** Sends one transactional email; a repeated idempotency key means Brevo already accepted it. */
export function createBrevoSender(config: Pick<NotificationConfig, "apiKey" | "fromEmail">, fetchImpl: typeof fetch = fetch) {
  return async (email: OutgoingEmail): Promise<void> => {
    const endpoint = "https://api.brevo.com/v3/smtp/email";
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json",
      "api-key": config.apiKey, idempotencyKey: email.idempotencyKey };
    const body = { sender: { email: config.fromEmail, name: "LSNB Alumni" }, to: [{ email: email.to }], subject: email.subject,
      textContent: email.text, htmlContent: email.html, headers: { idempotencyKey: email.idempotencyKey } };
    let response: Response;
    try {
      response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch { throw new NotificationError("delivery", 503); }
    if (response.ok) return;
    // Brevo treats the repeated idempotency key as an error, while the original delivery was accepted.
    if (response.status === 400) {
      const result = await response.json().catch(() => null) as { code?: string } | null;
      if (result?.code === "duplicate_parameter") return;
    }
    throw new NotificationError("delivery", response.status);
  };
}

export interface JobStore<Job> {
  claim(limit: number): Promise<Job[]>;
  finish(job: Job, success: boolean): Promise<void>;
}

export type DeliveryCounts = { claimed: number; delivered: number; failed: number };

export async function deliverJobs<Job>(store: JobStore<Job>, send: (job: Job) => Promise<void>, limit = ROUND_CAPACITY): Promise<DeliveryCounts> {
  const jobs = await store.claim(limit);
  let delivered = 0;
  let failed = 0;
  for (const job of jobs) {
    try { await send(job); }
    catch {
      failed++;
      await store.finish(job, false);
      continue;
    }
    // Do not change a successful delivery to "failed" if acknowledgement is lost.
    // The lease and stable provider idempotency key handle a later retry.
    await store.finish(job, true);
    delivered++;
  }
  return { claimed: jobs.length, delivered, failed };
}

/** A queue and the sender of its jobs, tied together so a job can only reach its own sender. */
export type NotificationChannel = { deliver: (limit: number) => Promise<DeliveryCounts> };

export function notificationChannel<Job>(store: JobStore<Job>, send: (job: Job) => Promise<void>): NotificationChannel {
  return { deliver: (limit) => deliverJobs(store, send, limit) };
}

/** Channels share one round's capacity in order: earlier ones are served first. */
export async function runNotificationRound(channels: NotificationChannel[], capacity = ROUND_CAPACITY): Promise<DeliveryCounts> {
  const total: DeliveryCounts = { claimed: 0, delivered: 0, failed: 0 };
  for (const channel of channels) {
    const remaining = capacity - total.claimed;
    if (remaining <= 0) break;
    const counts = await channel.deliver(remaining);
    total.claimed += counts.claimed;
    total.delivered += counts.delivered;
    total.failed += counts.failed;
  }
  return total;
}
