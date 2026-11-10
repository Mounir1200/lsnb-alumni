import { avatarPath } from "./avatarPath";

export const DELETION_CONFIRMATION = "SUPPRIMER";
export const ACCOUNT_DELETED_PATH = "/compte-supprime";

type Outcome = { error: unknown };

/** What erasing an account needs from Supabase: storage for the photo, the database, and the local session. */
export type DeletionClient = {
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<Outcome> } };
  rpc(name: "delete_my_account"): PromiseLike<Outcome>;
  auth: { signOut(options: { scope: "local" }): PromiseLike<Outcome> };
};

export type DeletionExit = { clearDrafts: () => void; leave: () => void };

/** The member types the word to confirm; its case and the spaces around it do not matter. */
export function isDeletionConfirmed(typed: string) {
  return typed.trim().toLocaleUpperCase("fr-FR") === DELETION_CONFIRMATION;
}

/**
 * Erases the member's account. Storage sits outside the database cascades, so
 * the photo goes first, while the session can still reach it. The database
 * then erases the account and everything tied to it. The device forgets the
 * profile drafts and leaves the members' pages before the session ends, so no
 * page sends the former member to the sign-in form.
 */
export async function deleteAccount(client: DeletionClient, userId: string, { clearDrafts, leave }: DeletionExit) {
  const photo = await client.storage.from("avatars").remove([avatarPath(userId)]);
  if (photo.error) throw new Error("Impossible de retirer votre photo. Rien n’a été supprimé : réessayez.");
  const account = await client.rpc("delete_my_account");
  if (account.error) {
    throw new Error("La suppression n’a pas abouti : votre compte existe toujours, sans sa photo. Réessayez dans un instant.");
  }
  clearDrafts();
  leave();
  await client.auth.signOut({ scope: "local" });
}
