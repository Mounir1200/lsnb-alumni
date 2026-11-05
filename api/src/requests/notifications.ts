import { renderRequestNotificationEmail, type RequestEmailEvent, type RequestEmailKind } from "../messaging/emailTemplate.js";
import {
  createBrevoSender,
  emailPattern,
  NotificationError,
  uuidPattern,
  type JobStore,
  type NotificationConfig,
} from "../notifications/delivery.js";

/** One email about one request: "received" goes to its recipient, "accepted" to its requester. */
export type RequestNotificationJob = {
  job_id: string;
  lease_token: string;
  request_id: string;
  event: RequestEmailEvent;
  request_kind: RequestEmailKind;
  email: string;
};

export type RequestNotificationStore = JobStore<RequestNotificationJob>;

const EVENTS: RequestEmailEvent[] = ["received", "accepted"];
const KINDS: RequestEmailKind[] = ["connection", "mentoring"];

/** The request queue's two service-role RPCs, for createRpcJobStore. */
export const REQUEST_QUEUE_RPCS = { claim: "request_claim_notifications", finish: "request_finish_notification" } as const;

function isSafeJob(job: RequestNotificationJob) {
  return uuidPattern.test(job.job_id) && uuidPattern.test(job.request_id) && emailPattern.test(job.email)
    && EVENTS.includes(job.event) && KINDS.includes(job.request_kind);
}

export function createRequestNotificationSender(config: Pick<NotificationConfig, "apiKey" | "fromEmail" | "siteUrl">,
  fetchImpl: typeof fetch = fetch) {
  const sendEmail = createBrevoSender(config, fetchImpl);
  return async (job: RequestNotificationJob): Promise<void> => {
    if (!isSafeJob(job)) throw new NotificationError("delivery", 400);
    // A received request is answered from the requests page; an accepted one opened a conversation.
    const actionUrl = job.event === "received"
      ? `${config.siteUrl}/espace/relations`
      : `${config.siteUrl}/espace/messages/${job.request_id}`;
    const { subject, text, html } = renderRequestNotificationEmail(job.event, job.request_kind, actionUrl, `${config.siteUrl}/espace/messages`);
    await sendEmail({ to: job.email, subject, text, html, idempotencyKey: job.job_id });
  };
}
