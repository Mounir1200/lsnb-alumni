import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createAvatarRemover } from "../accounts/avatarRemoval.js";
import { runNotificationRound } from "../notifications/delivery.js";
import { notificationChannels } from "../messaging/scheduler.js";

const owner = "6f1c2a52-0b9e-4c35-9a61-2d6f0d6b9a11";
const job = { job_id: "9b0f4f58-7a3c-4d2e-8f10-3c1d2e4f5a6b", lease_token: "1d3a5c7e-9b0f-4e2d-8c6b-a4f2e0d8c6b4", owner_id: owner };
type Call = { url: string; method?: string; body?: string; headers: Record<string, string> };

function recordingFetch(calls: Call[], status = 200): typeof fetch {
  return (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body as string, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(String(url).includes("/rpc/") ? [] : [{ name: `${owner}/avatar` }]), { status });
  }) as typeof fetch;
}

describe("Removing the photo of an erased account", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("removes exactly that account's photo from the avatars bucket, with the service key", async () => {
    const calls: Call[] = [];
    await createAvatarRemover({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test" }, recordingFetch(calls))(job);
    assert.deepEqual(calls, [{
      url: "https://project.supabase.co/storage/v1/object/avatars", method: "DELETE",
      body: JSON.stringify({ prefixes: [`${owner}/avatar`] }),
      headers: { apikey: "sb_secret_test", "content-type": "application/json" },
    }]);
    const legacy: Call[] = [];
    await createAvatarRemover({ supabaseUrl: "https://project.supabase.co", secretKey: "eyJlegacy" }, recordingFetch(legacy))(job);
    assert.equal(legacy[0]!.headers.Authorization, "Bearer eyJlegacy");
  });

  it("fails the job when Storage refuses or cannot be reached, so the queue tries again", async () => {
    const config = { supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_test" };
    await assert.rejects(createAvatarRemover(config, recordingFetch([], 500))(job), /storage failed \(500\)/);
    await assert.rejects(createAvatarRemover(config, (async () => { throw new Error("offline"); }) as typeof fetch)(job), /storage failed \(503\)/);
  });

  it("never sends a path built from something other than an account id", async () => {
    const calls: Call[] = [];
    await assert.rejects(createAvatarRemover({ supabaseUrl: "https://project.supabase.co", secretKey: "k" }, recordingFetch(calls))(
      { ...job, owner_id: `${owner}/../other` }), /storage failed \(422\)/);
    assert.deepEqual(calls, []);
  });

  it("serves the photos of erased accounts first in a notification round, before any e-mail", async () => {
    const calls: Call[] = [];
    globalThis.fetch = recordingFetch(calls);
    await runNotificationRound(notificationChannels({ supabaseUrl: "https://project.supabase.co", secretKey: "k", apiKey: "brevo",
      fromEmail: "contact@example.test", siteUrl: "https://site.example", hubUrl: "https://hub.example" }));
    assert.equal(calls[0]!.url, "https://project.supabase.co/rest/v1/rpc/claim_avatar_removals");
  });
});
