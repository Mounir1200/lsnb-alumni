import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ACCOUNT_APPROVED_RPCS, createAccountApprovedSender, type AccountApprovedJob } from "../approvals/accountApproved.js";
import { renderAccountApprovedEmail } from "../messaging/emailTemplate.js";
import { notificationChannels } from "../messaging/scheduler.js";
import { createRpcJobStore, NotificationError, runNotificationRound } from "../notifications/delivery.js";

const job: AccountApprovedJob = {
  job_id: "00000000-0000-4000-8000-000000000001", lease_token: "00000000-0000-4000-8000-000000000002", email: "newcomer@example.test",
};
const config = { apiKey: "provider-secret", fromEmail: "network@example.test", siteUrl: "https://network.example.test" };
const SIGN_IN = "https://network.example.test/connexion";

function capture() {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ messageId: "ok" }), { status: 201 });
  };
  return { calls, fetcher };
}

describe("The e-mail telling a member the team approved their account", () => {
  it("invites them to sign in, through Brevo, under the job's idempotency key", async () => {
    const { calls, fetcher } = capture();
    await createAccountApprovedSender(config, fetcher)(job);
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call?.url, "https://api.brevo.com/v3/smtp/email");
    assert.deepEqual(call?.body.to, [{ email: job.email }]);
    assert.equal(call?.headers.get("idempotencyKey"), job.job_id);
    assert.equal(call?.body.subject, "Votre compte LSNB Alumni est validé");
    assert.equal(call?.body.textContent, renderAccountApprovedEmail(SIGN_IN).text);
    assert.match(String(call?.body.htmlContent), /href="https:\/\/network\.example\.test\/connexion"/);
  });

  it("says only that the account is approved and how to sign in: no name, promotion or reason", () => {
    assert.equal(renderAccountApprovedEmail(SIGN_IN).text, [
      "LSNB ALUMNI",
      "Votre compte est validé.",
      "L’équipe du réseau a validé votre inscription : votre profil est désormais visible des autres membres. "
        + "Connectez-vous pour les retrouver dans l’annuaire et entrer en contact avec eux.",
      `Me connecter :\n${SIGN_IN}`,
      "Connectez-vous comme lors de votre inscription : avec votre adresse e-mail et votre mot de passe, ou avec Google. "
        + "Mot de passe oublié ? La page de connexion vous permet d’en choisir un nouveau.",
      "Vous recevez cet e-mail une seule fois, après la validation de votre inscription.",
      "LSNB Alumni\nLycée Scientifique National de Bobo-Dioulasso",
    ].join("\n\n"));
  });

  it("wears the site's colours, loads nothing remote and escapes its link", () => {
    const email = renderAccountApprovedEmail('https://network.example.test/connexion?a="<unsafe>');
    assert.match(email.html, /<title>Votre compte LSNB Alumni est validé<\/title>/);
    assert.match(email.html, />Bienvenue dans le réseau</);
    assert.match(email.html, /#0c2948/);
    assert.match(email.html, /href="https:\/\/network\.example\.test\/connexion\?a=&quot;&lt;unsafe&gt;"/);
    assert.doesNotMatch(email.html, /<unsafe>|<script|<img|<link|<iframe|@import|url\(/i);
  });

  it("never reaches Brevo with an unsafe address or job id", async () => {
    const { calls, fetcher } = capture();
    const send = createAccountApprovedSender(config, fetcher);
    for (const unsafe of [{ email: "victim@example.test\r\nBcc:other@example.test" }, { email: "not-an-address" }, { job_id: "../../secret" }]) {
      await assert.rejects(send({ ...job, ...unsafe }), NotificationError, JSON.stringify(unsafe));
    }
    assert.equal(calls.length, 0);
  });

  it("reaches its queue only through its two RPCs, with the server key", async () => {
    const { calls, fetcher } = capture();
    const store = createRpcJobStore<AccountApprovedJob>({ supabaseUrl: "https://project.supabase.co", secretKey: "sb_secret_server" },
      ACCOUNT_APPROVED_RPCS, async (input, init) => {
        await fetcher(input, init);
        return new Response(calls.length === 1 ? JSON.stringify([job]) : "", { status: 200 });
      });
    assert.deepEqual(await store.claim(2), [job]);
    await store.finish(job, true);
    assert.deepEqual(calls.map((call) => call.url), [
      "https://project.supabase.co/rest/v1/rpc/claim_account_approved_emails",
      "https://project.supabase.co/rest/v1/rpc/finish_account_approved_email",
    ]);
    assert.deepEqual(calls[1]?.body, { p_job_id: job.job_id, p_lease_token: job.lease_token, p_success: true });
    assert.equal(calls[0]?.headers.get("apikey"), "sb_secret_server");
  });
});

describe("A notification round", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("tells approved members right after removing erased accounts' photos, before any other e-mail", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url.replace("https://project.supabase.co/rest/v1/rpc/", "").replace("https://api.brevo.com/v3/smtp/email", "brevo"));
      if (url.endsWith("/claim_account_approved_emails")) return new Response(JSON.stringify([job]));
      if (url.startsWith("https://api.brevo.com/")) return new Response(JSON.stringify({ messageId: "ok" }), { status: 201 });
      return new Response(url.includes("/finish_") ? "" : "[]");
    }) as typeof fetch;
    const counts = await runNotificationRound(notificationChannels({ supabaseUrl: "https://project.supabase.co", secretKey: "k",
      apiKey: "brevo", fromEmail: "contact@example.test", siteUrl: "https://site.example", hubUrl: "https://hub.example" }));
    assert.deepEqual(calls, ["claim_avatar_removals", "claim_account_approved_emails", "brevo", "finish_account_approved_email",
      "messaging_claim_notifications", "request_claim_notifications", "hub_claim_approval_emails"]);
    assert.deepEqual(counts, { claimed: 1, delivered: 1, failed: 0 });
  });
});
