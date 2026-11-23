import { renderAccountApprovedEmail } from "../messaging/emailTemplate.js";
import { createBrevoSender, emailPattern, NotificationError, uuidPattern, type NotificationConfig } from "../notifications/delivery.js";

/**
 * The one e-mail telling a member the team approved their account, queued by
 * the database (supabase/migrations/20261123090001_account_approved_email.sql).
 */
export type AccountApprovedJob = { job_id: string; lease_token: string; email: string };

/** The account-approved queue's two service-role RPCs, for createRpcJobStore. */
export const ACCOUNT_APPROVED_RPCS = { claim: "claim_account_approved_emails", finish: "finish_account_approved_email" } as const;

export function createAccountApprovedSender(config: Pick<NotificationConfig, "apiKey" | "fromEmail" | "siteUrl">,
  fetchImpl: typeof fetch = fetch) {
  const sendEmail = createBrevoSender(config, fetchImpl);
  return async (job: AccountApprovedJob): Promise<void> => {
    if (!uuidPattern.test(job.job_id) || !emailPattern.test(job.email)) throw new NotificationError("delivery", 400);
    const { subject, text, html } = renderAccountApprovedEmail(`${config.siteUrl}/connexion`);
    await sendEmail({ to: job.email, subject, text, html, idempotencyKey: job.job_id });
  };
}
