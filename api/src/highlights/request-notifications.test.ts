import assert from "node:assert/strict";
import test from "node:test";
import { renderRequestNotificationEmail } from "../messaging/emailTemplate.js";
import { NotificationError } from "../messaging/notifications.js";
import { createRpcJobStore, notificationChannel, runNotificationRound } from "../notifications/delivery.js";
import {
  createRequestNotificationSender,
  REQUEST_QUEUE_RPCS,
  type RequestNotificationJob,
} from "../requests/notifications.js";

const job: RequestNotificationJob = {
  job_id: "00000000-0000-4000-8000-000000000001", lease_token: "00000000-0000-4000-8000-000000000002",
  request_id: "00000000-0000-4000-8000-000000000003", event: "received", request_kind: "connection",
  email: "recipient@example.test",
};
const config = { apiKey: "provider-secret", fromEmail: "network@example.test", siteUrl: "https://network.example.test" };

function capture() {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ messageId: "ok" }), { status: 201 });
  };
  return { calls, fetcher };
}

test("a received request is announced to its recipient with a link to their requests", async () => {
  const { calls, fetcher } = capture();
  await createRequestNotificationSender(config, fetcher)(job);
  const [call] = calls;
  assert.equal(call?.url, "https://api.brevo.com/v3/smtp/email");
  assert.deepEqual(call?.body.to, [{ email: job.email }]);
  assert.equal(call?.headers.get("idempotencyKey"), job.job_id);
  assert.match(String(call?.body.subject), /demande de connexion/);
  assert.match(String(call?.body.textContent), /https:\/\/network\.example\.test\/espace\/relations/);
});

test("an accepted request sends the requester to the conversation it opened", async () => {
  const { calls, fetcher } = capture();
  await createRequestNotificationSender(config, fetcher)({ ...job, event: "accepted", request_kind: "mentoring" });
  assert.match(String(calls[0]?.body.subject), /mentorat a été acceptée/);
  assert.match(String(calls[0]?.body.textContent), new RegExp(`/espace/messages/${job.request_id}`));
});

test("unsafe or unknown job input never reaches the email provider", async () => {
  const { calls, fetcher } = capture();
  const send = createRequestNotificationSender(config, fetcher);
  for (const unsafe of [
    { email: "victim@example.test\r\nBcc:other@example.test" },
    { request_id: "../../secret" },
    { event: "declined" },
    { request_kind: "contact" },
  ]) {
    await assert.rejects(send({ ...job, ...unsafe } as RequestNotificationJob), NotificationError);
  }
  assert.equal(calls.length, 0);
});

test("the request store uses only its two RPCs with the server key", async () => {
  const { calls, fetcher } = capture();
  const store = createRpcJobStore<RequestNotificationJob>({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_server" }, REQUEST_QUEUE_RPCS, async (input, init) => {
    await fetcher(input, init);
    return new Response(calls.length === 1 ? JSON.stringify([job]) : "", { status: 200 });
  });
  assert.deepEqual(await store.claim(3), [job]);
  await store.finish(job, false);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://project.supabase.co/rest/v1/rpc/request_claim_notifications",
    "https://project.supabase.co/rest/v1/rpc/request_finish_notification",
  ]);
  assert.deepEqual(calls[0]?.body, { p_limit: 3 });
  assert.deepEqual(calls[1]?.body, { p_job_id: job.job_id, p_lease_token: job.lease_token, p_success: false });
  assert.equal(calls[0]?.headers.get("apikey"), "sb_secret_server");
});

test("one scheduled round shares five emails, unread messages first", async () => {
  const limits: number[] = [];
  const channel = (available: number) => notificationChannel({
    claim: async (limit: number) => { limits.push(limit); return Array.from({ length: Math.min(limit, available) }, (_, index) => index); },
    finish: async () => undefined,
  }, async () => undefined);
  assert.deepEqual(await runNotificationRound([channel(3), channel(9)]), { claimed: 5, delivered: 5, failed: 0 });
  assert.deepEqual(limits, [5, 2]);
  limits.length = 0;
  assert.deepEqual(await runNotificationRound([channel(7), channel(9)]), { claimed: 5, delivered: 5, failed: 0 });
  assert.deepEqual(limits, [5]);
  limits.length = 0;
  assert.deepEqual(await runNotificationRound([channel(4), channel(9)]), { claimed: 5, delivered: 5, failed: 0 });
  assert.deepEqual(limits, [5, 1]);
});

test("request emails carry no name or message and escape their link", () => {
  for (const event of ["received", "accepted"] as const) {
    for (const kind of ["connection", "mentoring"] as const) {
      const email = renderRequestNotificationEmail(event, kind, 'https://network.example.test/?a="<unsafe>', "https://network.example.test/espace/messages");
      assert.doesNotMatch(email.html, /<unsafe>|<script|<img|<link|<iframe|@import|url\(/i);
      assert.match(email.html, /#0c2948/);
      assert.match(email.text, /Par discrétion/);
      assert.ok(email.text.length > 150);
    }
  }
});
