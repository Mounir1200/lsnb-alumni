import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_QUEUE_RPCS,
  createApprovalNotificationSender,
  type ApprovalNotificationJob,
} from "../approvals/notifications.js";
import { renderApprovalNotificationEmail } from "../messaging/emailTemplate.js";
import { NotificationError } from "../messaging/notifications.js";
import { createRpcJobStore, loadNotificationConfig } from "../notifications/delivery.js";

const job: ApprovalNotificationJob = {
  job_id: "00000000-0000-4000-8000-000000000001", lease_token: "00000000-0000-4000-8000-000000000002",
  email: "moderator@example.test", waiting: 1, promotion: 2020,
};
const config = { apiKey: "provider-secret", fromEmail: "network@example.test", hubUrl: "https://hub.example.test" };

function capture() {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ messageId: "ok" }), { status: 201 });
  };
  return { calls, fetcher };
}

test("a moderator is asked to approve their promotion's newcomers, with a link to the hub's queue", async () => {
  const { calls, fetcher } = capture();
  await createApprovalNotificationSender(config, fetcher)(job);
  const [call] = calls;
  assert.equal(call?.url, "https://api.brevo.com/v3/smtp/email");
  assert.deepEqual(call?.body.to, [{ email: job.email }]);
  assert.equal(call?.headers.get("idempotencyKey"), job.job_id);
  assert.match(String(call?.body.subject), /^Une inscription attend votre validation$/);
  assert.match(String(call?.body.textContent), /Dans la promotion 2020, un nouveau compte attend d’être validé/);
  assert.match(String(call?.body.textContent), /https:\/\/hub\.example\.test\/#approvals/);
});

test("an administrator learns how many newcomers wait across the network", async () => {
  const { calls, fetcher } = capture();
  await createApprovalNotificationSender(config, fetcher)({ ...job, waiting: 3, promotion: null });
  assert.match(String(calls[0]?.body.subject), /^3 inscriptions attendent votre validation$/);
  assert.match(String(calls[0]?.body.textContent), /Dans le réseau, 3 nouveaux comptes attendent d’être validés/);
});

test("unsafe job input never reaches the e-mail provider", async () => {
  const { calls, fetcher } = capture();
  const send = createApprovalNotificationSender(config, fetcher);
  for (const unsafe of [
    { email: "victim@example.test\r\nBcc:other@example.test" },
    { job_id: "../../secret" },
    { waiting: 0 },
    { waiting: 1.5 },
    { promotion: 1999 },
    { promotion: "2020" },
  ]) {
    await assert.rejects(send({ ...job, ...unsafe } as ApprovalNotificationJob), NotificationError, JSON.stringify(unsafe));
  }
  assert.equal(calls.length, 0);
});

test("the oldest and newest promotions, and a long queue, still reach the team", async () => {
  const { calls, fetcher } = capture();
  const send = createApprovalNotificationSender(config, fetcher);
  for (const edge of [{ promotion: 2017 }, { promotion: 2040 }, { waiting: 10_000 }]) await send({ ...job, ...edge });
  assert.equal(calls.length, 3);
  for (const beyond of [{ promotion: 2016 }, { promotion: 2041 }, { waiting: 10_001 }]) {
    await assert.rejects(send({ ...job, ...beyond }), NotificationError, JSON.stringify(beyond));
  }
  assert.equal(calls.length, 3);
});

test("the approval store uses only its two RPCs with the server key", async () => {
  const { calls, fetcher } = capture();
  const store = createRpcJobStore<ApprovalNotificationJob>({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_server" },
    APPROVAL_QUEUE_RPCS, async (input, init) => {
      await fetcher(input, init);
      return new Response(calls.length === 1 ? JSON.stringify([job]) : "", { status: 200 });
    });
  assert.deepEqual(await store.claim(2), [job]);
  await store.finish(job, true);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://project.supabase.co/rest/v1/rpc/hub_claim_approval_emails",
    "https://project.supabase.co/rest/v1/rpc/hub_finish_approval_email",
  ]);
  assert.equal(calls[0]?.headers.get("apikey"), "sb_secret_server");
});

test("approval e-mails carry no name and escape their link", () => {
  const email = renderApprovalNotificationEmail(2, 2020, 'https://hub.example.test/?a="<unsafe>');
  assert.doesNotMatch(email.html, /<unsafe>|<script|<img|<link|<iframe|@import|url\(/i);
  assert.match(email.html, /#0c2948/);
  assert.match(email.text, /aucun nom/);
});

test("the hub link comes from MESSAGING_HUB_URL, or the production hub by default", () => {
  const valid = { BREVO_API_KEY: "secret", MESSAGING_FROM_EMAIL: "network@example.test", MESSAGING_SITE_URL: "https://network.example.test",
    SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "db-secret" };
  assert.equal(loadNotificationConfig(valid).hubUrl, "https://lsnb-alumni-hub.onrender.com");
  assert.equal(loadNotificationConfig({ ...valid, MESSAGING_HUB_URL: "https://hub.example.test/" }).hubUrl, "https://hub.example.test");
  for (const hub of ["http://hub.example.test", "https://user@hub.example.test", "https://hub.example.test/admin", "https://hub.example.test/#x"]) {
    assert.throws(() => loadNotificationConfig({ ...valid, MESSAGING_HUB_URL: hub }), NotificationError, hub);
  }
});
