import { renderMessageNotificationEmail } from "./emailTemplate.js";

export type NotificationJob = {
  job_id: string;
  lease_token: string;
  recipient_id: string;
  conversation_id: string;
  email: string;
  unread_count: number;
};

export interface NotificationStore {
  claim(limit: number): Promise<NotificationJob[]>;
  finish(job: NotificationJob, success: boolean): Promise<void>;
}

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

const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function createNotificationStore(config: Pick<NotificationConfig, "supabaseUrl" | "secretKey">,
  fetchImpl: typeof fetch = fetch): NotificationStore {
  async function rpc<T>(name: string, body: object): Promise<T> {
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
  }
  return {
    claim: (limit) => rpc<NotificationJob[]>("messaging_claim_notifications", { p_limit: limit }),
    finish: (job, success) => rpc<void>("messaging_finish_notification", {
      p_job_id: job.job_id, p_lease_token: job.lease_token, p_success: success,
    }),
  };
}

export function createNotificationSender(config: Pick<NotificationConfig, "apiKey" | "fromEmail" | "siteUrl">,
  fetchImpl: typeof fetch = fetch) {
  return async (job: NotificationJob): Promise<void> => {
    if (!uuidPattern.test(job.job_id) || !uuidPattern.test(job.conversation_id) || !emailPattern.test(job.email)) {
      throw new NotificationError("delivery", 400);
    }
    const url = `${config.siteUrl}/espace/messages/${job.conversation_id}`;
    // Stable payload across retries; no preview, sender identity or changing unread count leaves the site.
    const { subject, text, html } = renderMessageNotificationEmail(url, `${config.siteUrl}/espace/messages`);
    const endpoint = "https://api.brevo.com/v3/smtp/email";
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json",
      "api-key": config.apiKey, idempotencyKey: job.job_id };
    const body = { sender: { email: config.fromEmail, name: "LSNB Alumni" }, to: [{ email: job.email }], subject,
      textContent: text, htmlContent: html, headers: { idempotencyKey: job.job_id } };
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

export async function deliverNotifications(store: NotificationStore, send: (job: NotificationJob) => Promise<void>) {
  // Five sequential jobs fit inside the five-minute lease even at both 15s timeouts.
  const jobs = await store.claim(5);
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
  return { event: "messaging.notifications", claimed: jobs.length, delivered, failed };
}
