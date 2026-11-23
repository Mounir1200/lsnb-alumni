import { NotificationError, serviceHeaders, uuidPattern, type NotificationConfig } from "../notifications/delivery.js";

/**
 * The photo of an erased account, queued by the database when the profile
 * went (supabase/migrations/20261123121010_account_deletion_safeguards.sql).
 */
export type AvatarRemovalJob = { job_id: string; lease_token: string; owner_id: string };

export const AVATAR_REMOVAL_RPCS = { claim: "claim_avatar_removals", finish: "finish_avatar_removal" } as const;

/**
 * Removes the photo through the Storage API, the only way to delete the file
 * itself. Storage answers the same whether the photo is still there or not, so
 * a retry after a lost answer is harmless.
 */
export function createAvatarRemover(config: Pick<NotificationConfig, "supabaseUrl" | "secretKey">, fetchImpl: typeof fetch = fetch) {
  return async (job: AvatarRemovalJob): Promise<void> => {
    if (!uuidPattern.test(job.owner_id)) throw new NotificationError("storage", 422);
    let response: Response;
    try {
      response = await fetchImpl(`${config.supabaseUrl}/storage/v1/object/avatars`, {
        method: "DELETE", headers: serviceHeaders(config.secretKey),
        body: JSON.stringify({ prefixes: [`${job.owner_id}/avatar`] }),
        signal: AbortSignal.timeout(15_000), redirect: "error",
      });
    } catch { throw new NotificationError("storage", 503); }
    if (!response.ok) throw new NotificationError("storage", response.status);
  };
}
