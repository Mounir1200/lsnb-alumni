import assert from "node:assert/strict";
import test from "node:test";
import { buildMessagingActivationEmail, renderConfirmationEmail, renderMessageNotificationEmail } from "../messaging/emailTemplate.js";
import { CONFIRMATION_RESEND_SUCCESS, getLoginError, resendSignupConfirmation } from "../../../src/lib/emailConfirmation.ts";
import { createNotificationSender, createNotificationStore, deliverNotifications, loadNotificationConfig, NotificationError,
  type NotificationJob, type NotificationStore } from "../messaging/notifications.js";

const job: NotificationJob = { job_id: "00000000-0000-4000-8000-000000000001", lease_token: "00000000-0000-4000-8000-000000000002",
  recipient_id: "00000000-0000-4000-8000-000000000003", conversation_id: "00000000-0000-4000-8000-000000000004",
  email: "recipient@example.test", unread_count: 2 };
const config = { apiKey: "provider-secret", fromEmail: "network@example.test", siteUrl: "https://network.example.test" };
const environment = { BREVO_API_KEY: "secret", MESSAGING_FROM_EMAIL: config.fromEmail, MESSAGING_SITE_URL: config.siteUrl,
  SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "db-secret" };

test("notification configuration requires complete server credentials and a safe HTTPS origin before claiming", () => {
  assert.equal(loadNotificationConfig(environment).siteUrl, config.siteUrl);
  for (const key of Object.keys(environment)) assert.throws(() => loadNotificationConfig({ ...environment, [key]: "" }), NotificationError);
  for (const url of ["http://network.example.test", "https://user:password@network.example.test", "https://network.example.test/?redirect=evil", "https://network.example.test/path"]) {
    assert.throws(() => loadNotificationConfig({ ...environment, MESSAGING_SITE_URL: url }), NotificationError);
  }
});

test("Brevo receives only the authenticated queue recipient and a private-site link, with stable idempotency", async () => {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const send = createNotificationSender(config, async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ messageId: "ok" }), { status: 201 });
  });
  await send(job);
  await send({ ...job, unread_count: 7 });
  assert.equal(calls[0]!.url, "https://api.brevo.com/v3/smtp/email");
  assert.deepEqual(calls[0]!.body.to, [{ email: job.email }]);
  assert.equal(calls[0]!.headers.get("idempotencyKey"), job.job_id);
  assert.deepEqual(calls[0]!.body, calls[1]!.body);
  assert.match(String(calls[0]!.body.textContent), new RegExp(`/espace/messages/${job.conversation_id}`));
  assert.ok(!JSON.stringify(calls[0]!.body).includes(job.recipient_id));
  assert.ok(!JSON.stringify(calls[0]!.body).includes("unread_count"));
});

test("unsafe recipient/job input never reaches the email provider", async () => {
  let calls = 0;
  const send = createNotificationSender(config, async () => { calls++; return new Response(null, { status: 201 }); });
  await assert.rejects(send({ ...job, email: "victim@example.test\r\nBcc:other@example.test" }), NotificationError);
  await assert.rejects(send({ ...job, conversation_id: "../../secret" }), NotificationError);
  assert.equal(calls, 0);
});

test("documented duplicate delivery is acknowledged; other upstream errors are sanitized", async () => {
  const duplicate = createNotificationSender(config, async () => new Response(JSON.stringify({ code: "duplicate_parameter" }), { status: 400 }));
  await duplicate(job);
  const fail = createNotificationSender(config, async () => new Response("private recipient data and secret", { status: 429 }));
  await assert.rejects(fail(job), (error: unknown) => error instanceof NotificationError && error.status === 429 && !error.message.includes("secret"));
});

test("storage sends secret credentials only to Supabase and acknowledges exact job lease", async () => {
  const calls: { url: string; body: unknown; headers: Headers }[] = [];
  const store = createNotificationStore({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_server" }, async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(calls.length === 1 ? JSON.stringify([job]) : "", { status: 200 });
  });
  assert.deepEqual(await store.claim(20), [job]);
  await store.finish(job, true);
  assert.equal(calls[0]!.headers.get("apikey"), "sb_secret_server");
  assert.equal(calls[0]!.headers.has("authorization"), false);
  assert.deepEqual(calls[1]!.body, { p_job_id: job.job_id, p_lease_token: job.lease_token, p_success: true });
});

test("per-job failure releases only its lease and the next recipient is still processed", async () => {
  const acknowledgements: boolean[] = [];
  const store: NotificationStore = { claim: async () => [job, { ...job, job_id: "00000000-0000-4000-8000-000000000005" }],
    finish: async (_job, success) => { acknowledgements.push(success); } };
  let attempts = 0;
  const result = await deliverNotifications(store, async () => { if (++attempts === 1) throw new Error("unavailable"); });
  assert.deepEqual(acknowledgements, [false, true]);
  assert.deepEqual(result, { event: "messaging.notifications", claimed: 2, delivered: 1, failed: 1 });
});

test("a lost acknowledgement never falsely records a successful email as a failed delivery", async () => {
  const acknowledgements: boolean[] = [];
  const store: NotificationStore = { claim: async () => [job], finish: async (_job, success) => {
    acknowledgements.push(success); throw new Error("connection lost");
  } };
  await assert.rejects(deliverNotifications(store, async () => undefined));
  assert.deepEqual(acknowledgements, [true]);
});

test("transactional templates preserve the LSNB palette, clear action and text alternative without remote tracking assets", () => {
  const confirmation = renderConfirmationEmail("{{ .ConfirmationURL }}");
  const notification = renderMessageNotificationEmail("https://network.example.test/espace/messages/example", "https://network.example.test/espace/messages");
  for (const email of [confirmation, notification]) {
    assert.match(email.html, /<html lang="fr">/);
    assert.match(email.html, /#0c2948/);
    assert.match(email.html, /#c27d38/);
    assert.match(email.html, /role="presentation"/);
    assert.match(email.html, /max-width:600px/);
    assert.doesNotMatch(email.html, /<script|<img|<link|<iframe|@import|url\(/i);
    assert.ok(email.text.length > 150);
  }
  assert.match(confirmation.html, /href="\{\{ \.ConfirmationURL \}\}"/);
  assert.match(confirmation.text, /\{\{ \.ConfirmationURL \}\}/);
  assert.match(notification.text, /Aucun extrait ni nom d’expéditeur/);
});

test("email links are escaped so a malformed URL cannot inject HTML", () => {
  const email = renderMessageNotificationEmail('https://network.example.test/?a="<unsafe>&b=2', 'https://network.example.test/?q="unsafe');
  assert.doesNotMatch(email.html, /<unsafe>/);
  assert.match(email.html, /&quot;&lt;unsafe&gt;&amp;b=2/);
});

test("messaging activation exposes only an eight-digit one-time code and no clickable or remote asset", () => {
  const email = buildMessagingActivationEmail("01234567");
  assert.match(email.html, /01234567/);
  assert.match(email.text, /\n01234567\n/);
  assert.match(email.text, /10 minutes/);
  assert.match(email.text, /utilisable une seule fois/);
  assert.match(email.text, /Si vous n’avez pas demandé cette activation, ne communiquez pas ce code\./);
  assert.doesNotMatch(email.html, /href=|src=|<img|<script|<link|<iframe/i);
  for (const invalid of ["1234567", "123456789", "1234 5678", "1234abcd", '<script>', ""]) {
    assert.throws(() => buildMessagingActivationEmail(invalid), /huit chiffres/);
  }
});

test("confirmation resend normalizes the address, preserves the callback and rejects invalid addresses locally", async () => {
  const calls: unknown[] = [];
  const auth = { resend: async (input: unknown) => { calls.push(input); return { error: null }; } } as unknown as Parameters<typeof resendSignupConfirmation>[0];
  await resendSignupConfirmation(auth, "  member@example.test  ", "https://network.example.test/auth/callback?next=%2Fespace");
  assert.deepEqual(calls, [{ type: "signup", email: "member@example.test", options: { emailRedirectTo: "https://network.example.test/auth/callback?next=%2Fespace" } }]);
  await assert.rejects(resendSignupConfirmation(auth, "bad-email", "https://network.example.test/auth/callback"), /adresse e-mail valide/);
  assert.equal(calls.length, 1);
  assert.match(CONFIRMATION_RESEND_SUCCESS, /^Si cette adresse/);
});

test("confirmation resend and login errors do not expose provider details or leave rejected promises uncaught", async () => {
  for (const resend of [async () => { throw new Error("secret upstream response"); }, async () => ({ error: { code: "unknown", message: "secret upstream response" } })]) {
    const auth = { resend } as unknown as Parameters<typeof resendSignupConfirmation>[0];
    await assert.rejects(resendSignupConfirmation(auth, "member@example.test", "https://network.example.test/auth/callback"), (error: unknown) => {
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /secret/); assert.match(error.message, /Réessayez|réessayez/); return true;
    });
  }
  const limited = { resend: async () => ({ error: { code: "over_email_send_rate_limit" } }) } as unknown as Parameters<typeof resendSignupConfirmation>[0];
  await assert.rejects(resendSignupConfirmation(limited, "member@example.test", "https://network.example.test/auth/callback"), /Patientez une minute/);
  assert.match(getLoginError({ code: "email_not_confirmed" }), /Confirmez d’abord/);
  assert.doesNotMatch(getLoginError(new Error("secret detail")), /secret/);
});
