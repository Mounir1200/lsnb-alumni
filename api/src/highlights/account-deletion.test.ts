import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountDeletionBlocked, DELETION_SIGN_IN_PATH, deleteAccount, deletionStatus, isDeletionConfirmed, type DeletionClient,
} from "../../../src/lib/accountDeletion.ts";
import { getPostAuthPath } from "../../../src/lib/auth.ts";

type Answer = { data?: unknown; error: { code?: string; message: string } | null };

function fakeClient(steps: string[], answers: { status?: Answer; account?: Answer } = {}): DeletionClient {
  return {
    rpc: async (name) => {
      steps.push(`rpc:${name}`);
      return (name === "account_deletion_status" ? answers.status : answers.account) ?? { data: "ready", error: null };
    },
    auth: { signOut: async ({ scope }) => { steps.push(`session:${scope}`); return { error: null }; } },
  };
}
const exit = (steps: string[]) => ({ clearDrafts: () => { steps.push("drafts"); }, leave: () => { steps.push("leave"); } });

test("the database erases the account, photo included; the device forgets the drafts and leaves before the session ends", async () => {
  const steps: string[] = [];
  await deleteAccount(fakeClient(steps), exit(steps));
  assert.deepEqual(steps, ["rpc:delete_my_account", "drafts", "leave", "session:local"]);
});

test("an old sign-in or the last super administrator keeps the account, and says why", async () => {
  for (const [code, reason] of [["LS428", "sign_in_again"], ["LS409", "last_super_admin"]] as const) {
    const steps: string[] = [];
    const refused = fakeClient(steps, { account: { error: { code, message: "refused" } } });
    await assert.rejects(deleteAccount(refused, exit(steps)), (error) => error instanceof AccountDeletionBlocked && error.reason === reason);
    assert.deepEqual(steps, ["rpc:delete_my_account"]);
  }
});

test("a failed erasure keeps the member signed in, on the page", async () => {
  const steps: string[] = [];
  const failing = fakeClient(steps, { account: { error: { code: "XX000", message: "database unavailable" } } });
  await assert.rejects(deleteAccount(failing, exit(steps)), /existe toujours/);
  assert.deepEqual(steps, ["rpc:delete_my_account"]);
});

test("reads whether the account can be erased now, and trusts no other answer", async () => {
  for (const status of ["ready", "sign_in_again", "last_super_admin"]) {
    assert.equal(await deletionStatus(fakeClient([], { status: { data: status, error: null } })), status);
  }
  await assert.rejects(deletionStatus(fakeClient([], { status: { data: "erase_everyone", error: null } })), /Réessayez/);
  await assert.rejects(deletionStatus(fakeClient([], { status: { data: null, error: { message: "offline" } } })), /Réessayez/);
});

test("signing in again to erase the account leads back to the deletion section of the profile editor", () => {
  assert.equal(new URL(DELETION_SIGN_IN_PATH, "https://lsnb.invalid").pathname, "/connexion");
  const next = new URL(DELETION_SIGN_IN_PATH, "https://lsnb.invalid").searchParams.get("next");
  assert.equal(getPostAuthPath(next), "/espace/modifier#supprimer-mon-compte");
});

test("the confirmation word is accepted whatever its case and the spaces around it", () => {
  for (const typed of ["SUPPRIMER", " supprimer ", "Supprimer"]) assert.equal(isDeletionConfirmed(typed), true, typed);
  for (const typed of ["", "SUPPRIME", "supprimer mon compte"]) assert.equal(isDeletionConfirmed(typed), false, typed);
});
