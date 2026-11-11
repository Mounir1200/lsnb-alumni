import { renderApprovalNotificationEmail } from "../messaging/emailTemplate.js";
import {
  createBrevoSender,
  emailPattern,
  NotificationError,
  uuidPattern,
  type JobStore,
  type NotificationConfig,
} from "../notifications/delivery.js";

/** One e-mail to one team member, counting the newcomers who wait in their scope. */
export type ApprovalNotificationJob = {
  job_id: string;
  lease_token: string;
  email: string;
  waiting: number;
  /** The moderator's promotion; null for administrators, who cover the network. */
  promotion: number | null;
};

export type ApprovalNotificationStore = JobStore<ApprovalNotificationJob>;

/** The approval queue's two service-role RPCs, for createRpcJobStore. */
export const APPROVAL_QUEUE_RPCS = { claim: "hub_claim_approval_emails", finish: "hub_finish_approval_email" } as const;

// The promotions the database accepts for a moderator (private.hub_staff).
const FIRST_PROMOTION = 2017;
const LAST_PROMOTION = 2040;
const MOST_WAITING = 10_000;

const isPromotion = (value: unknown) =>
  value === null || (Number.isInteger(value) && (value as number) >= FIRST_PROMOTION && (value as number) <= LAST_PROMOTION);

function isSafeJob(job: ApprovalNotificationJob) {
  return uuidPattern.test(job.job_id) && emailPattern.test(job.email)
    && Number.isInteger(job.waiting) && job.waiting >= 1 && job.waiting <= MOST_WAITING && isPromotion(job.promotion);
}

export function createApprovalNotificationSender(config: Pick<NotificationConfig, "apiKey" | "fromEmail" | "hubUrl">,
  fetchImpl: typeof fetch = fetch) {
  const sendEmail = createBrevoSender(config, fetchImpl);
  return async (job: ApprovalNotificationJob): Promise<void> => {
    if (!isSafeJob(job)) throw new NotificationError("delivery", 400);
    const { subject, text, html } = renderApprovalNotificationEmail(job.waiting, job.promotion, `${config.hubUrl}/#approvals`);
    await sendEmail({ to: job.email, subject, text, html, idempotencyKey: job.job_id });
  };
}
