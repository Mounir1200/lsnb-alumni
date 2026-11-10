import assert from "node:assert/strict";
import test from "node:test";
import { deleteAccount, isDeletionConfirmed, type DeletionClient } from "../../../src/lib/accountDeletion.ts";

function fakeClient(steps: string[], failing: { photo?: boolean; account?: boolean } = {}): DeletionClient {
  return {
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          steps.push(`photo:${bucket}/${paths.join(",")}`);
          return { error: failing.photo ? new Error("storage unavailable") : null };
        },
      }),
    },
    rpc: async (name) => {
      steps.push(`account:${name}`);
      return { error: failing.account ? { message: "database unavailable" } : null };
    },
    auth: { signOut: async ({ scope }) => { steps.push(`session:${scope}`); return { error: null }; } },
  };
}
const exit = (steps: string[]) => ({ clearDrafts: () => { steps.push("drafts"); }, leave: () => { steps.push("leave"); } });

test("the photo goes first, then the account; the device forgets the drafts and leaves before the session ends", async () => {
  const steps: string[] = [];
  await deleteAccount(fakeClient(steps), "member-1", exit(steps));
  assert.deepEqual(steps, ["photo:avatars/member-1/avatar", "account:delete_my_account", "drafts", "leave", "session:local"]);
});

test("nothing is erased when the photo cannot be removed", async () => {
  const steps: string[] = [];
  await assert.rejects(deleteAccount(fakeClient(steps, { photo: true }), "member-1", exit(steps)), /Rien n’a été supprimé/);
  assert.deepEqual(steps, ["photo:avatars/member-1/avatar"]);
});

test("a failed erasure keeps the member signed in, on the page", async () => {
  const steps: string[] = [];
  await assert.rejects(deleteAccount(fakeClient(steps, { account: true }), "member-1", exit(steps)), /existe toujours/);
  assert.deepEqual(steps, ["photo:avatars/member-1/avatar", "account:delete_my_account"]);
});

test("the confirmation word is accepted whatever its case and the spaces around it", () => {
  for (const typed of ["SUPPRIMER", " supprimer ", "Supprimer"]) assert.equal(isDeletionConfirmed(typed), true, typed);
  for (const typed of ["", "SUPPRIME", "supprimer mon compte"]) assert.equal(isDeletionConfirmed(typed), false, typed);
});
