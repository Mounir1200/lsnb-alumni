import { renderMessageNotificationEmail } from "./emailTemplate.js";
import {
  createBrevoSender,
  createRpcJobStore,
  deliverJobs,
  emailPattern,
  NotificationError,
  uuidPattern,
  type JobStore,
  type NotificationConfig,
} from "../notifications/delivery.js";

export { loadNotificationConfig, NotificationError, type NotificationConfig } from "../notifications/delivery.js";

export type NotificationJob = {
  job_id: string;
  lease_token: string;
  recipient_id: string;
  conversation_id: string;
  email: string;
  unread_count: number;
};

export type NotificationStore = JobStore<NotificationJob>;

export function createNotificationStore(config: Pick<NotificationConfig, "supabaseUrl" | "secretKey">,
  fetchImpl: typeof fetch = fetch): NotificationStore {
  return createRpcJobStore(config, { claim: "messaging_claim_notifications", finish: "messaging_finish_notification" }, fetchImpl);
}

export function createNotificationSender(config: Pick<NotificationConfig, "apiKey" | "fromEmail" | "siteUrl">,
  fetchImpl: typeof fetch = fetch) {
  const sendEmail = createBrevoSender(config, fetchImpl);
  return async (job: NotificationJob): Promise<void> => {
    if (!uuidPattern.test(job.job_id) || !uuidPattern.test(job.conversation_id) || !emailPattern.test(job.email)) {
      throw new NotificationError("delivery", 400);
    }
    const url = `${config.siteUrl}/espace/messages/${job.conversation_id}`;
    // Stable payload across retries; no preview, sender identity or changing unread count leaves the site.
    const { subject, text, html } = renderMessageNotificationEmail(url, `${config.siteUrl}/espace/messages`);
    await sendEmail({ to: job.email, subject, text, html, idempotencyKey: job.job_id });
  };
}

export async function deliverNotifications(store: NotificationStore, send: (job: NotificationJob) => Promise<void>) {
  return { event: "messaging.notifications", ...await deliverJobs(store, send) };
}
