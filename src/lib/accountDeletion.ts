import { EDIT_PROFILE_PATH } from "./invitations";

export const DELETION_CONFIRMATION = "SUPPRIMER";
export const ACCOUNT_DELETED_PATH = "/compte-supprime";
export const DELETE_ACCOUNT_SECTION_ID = "supprimer-mon-compte";
/** Where a member signs in again before erasing their account: back to that section afterwards. */
export const DELETION_SIGN_IN_PATH = `/connexion?${new URLSearchParams({ next: `${EDIT_PROFILE_PATH}#${DELETE_ACCOUNT_SECTION_ID}` })}`;

/** What public.account_deletion_status() answers: erasing now, or why not. */
export type DeletionStatus = "ready" | "sign_in_again" | "last_super_admin";
export type DeletionBlocker = Exclude<DeletionStatus, "ready">;

/** The database kept the account for a reason the member can act on. */
export class AccountDeletionBlocked extends Error {
  constructor(readonly reason: DeletionBlocker) {
    super(`Account deletion refused: ${reason}`);
    this.name = "AccountDeletionBlocked";
  }
}

type RpcOutcome = { data?: unknown; error: { code?: string } | null };

/** What erasing an account needs from Supabase: the database, and the local session. */
export type DeletionClient = {
  rpc(name: "delete_my_account" | "account_deletion_status"): PromiseLike<RpcOutcome>;
  auth: { signOut(options: { scope: "local" }): PromiseLike<{ error: unknown }> };
};

export type DeletionExit = { clearDrafts: () => void; leave: () => void };

const STATUSES: ReadonlySet<string> = new Set<DeletionStatus>(["ready", "sign_in_again", "last_super_admin"]);
const BLOCKERS: ReadonlyMap<string, DeletionBlocker> = new Map([["LS428", "sign_in_again"], ["LS409", "last_super_admin"]]);

/** The member types the word to confirm; its case and the spaces around it do not matter. */
export function isDeletionConfirmed(typed: string) {
  return typed.trim().toLocaleUpperCase("fr-FR") === DELETION_CONFIRMATION;
}

/** Whether the account can be erased now, asked before the member types the confirmation word. */
export async function deletionStatus(client: DeletionClient): Promise<DeletionStatus> {
  const { data, error } = await client.rpc("account_deletion_status");
  if (error || typeof data !== "string" || !STATUSES.has(data)) {
    throw new Error("Impossible de vérifier votre compte pour l’instant. Réessayez dans un instant.");
  }
  return data as DeletionStatus;
}

/**
 * Erases the member's account. The database checks the sign-in is recent,
 * erases the account and everything tied to it, and has the photo removed
 * from storage. The device then forgets the profile drafts and leaves the
 * members' pages before the session ends, so no page sends the former member
 * to the sign-in form.
 */
export async function deleteAccount(client: DeletionClient, { clearDrafts, leave }: DeletionExit) {
  const { error } = await client.rpc("delete_my_account");
  if (error) {
    const blocker = error.code === undefined ? undefined : BLOCKERS.get(error.code);
    if (blocker) throw new AccountDeletionBlocked(blocker);
    throw new Error("La suppression n’a pas abouti : votre compte existe toujours. Réessayez dans un instant.");
  }
  clearDrafts();
  leave();
  await client.auth.signOut({ scope: "local" });
}
