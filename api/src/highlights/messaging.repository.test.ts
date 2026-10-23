import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createMessagingRepository, type ConversationMessage, type MessagingSession } from "../../../src/lib/messagingData.ts";
import { generateMessagingIdentity, encryptMessage } from "../../../src/lib/messagingCrypto.ts";
import { createMessagingIdentityRepository } from "../../../src/lib/messagingIdentityData.ts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = id(1), peer = id(2), conversation = id(10);
const [alice, bob] = await Promise.all([generateMessagingIdentity(owner), generateMessagingIdentity(peer)]);
const session = (): MessagingSession => ({ userId: owner, identity: alice.unlocked });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rawMessage = (sequence: number, body: string, sender = peer, recipient = owner, nonce = id(sequence + 200)) => ({
  id: id(sequence + 100), sequence, conversation_id: conversation, sender_id: sender, recipient_id: recipient,
  body, client_nonce: nonce, created_at: "2026-10-23T12:00:00Z", read_at: null,
});
const member = (memberId: string) => ({ id: memberId, first_name: "Membre", last_name: "Test", member_role: "alumni",
  graduation_year: 2020, specialty: "Sciences", offers_mentoring: true, photo_url: null });
const request = (value: number) => ({ id: id(value), requester_id: owner, recipient_id: peer,
  request_kind: "contact", status: "accepted", created_at: "2026-10-21T12:00:00Z",
  responded_at: "2026-10-22T12:00:00Z", requester: member(owner), recipient: member(peer), offer_id: null, offer: null });

function repository(fetcher: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const client = createClient("https://database.example", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => fetcher(new URL(String(input)), init ?? {}) },
  });
  return createMessagingRepository(client);
}
const peerResponse = () => json({ user_id: peer, public_key: bob.identity.public_key });
const encryptedIncoming = (sequence: number, text = `Message privé ${sequence}`) => encryptMessage(bob.unlocked, alice.identity.public_key,
  { conversationId: conversation, senderId: peer, recipientId: owner, clientNonce: id(sequence + 200) }, text);

test("inbox paginates under a low row cap without fetching or previewing legacy clear introductions", async () => {
  const requests = [request(11), request(10)];
  const summaries = [11, 10].map((value) => ({ conversation_id: id(value), last_message_body: "DO NOT DISPLAY ANY SERVER PREVIEW",
    last_message_at: `2026-10-${value + 10}T13:00:00Z`, last_sequence: value, unread_count: value === 10 ? 3 : 0 }));
  const cursors: unknown[] = [];
  const repo = repository((url, init) => {
    if (url.pathname.endsWith("connection_requests")) {
      assert.equal(url.searchParams.get("status"), "eq.accepted");
      assert.doesNotMatch(url.searchParams.get("select")!, /\bmessage\b/);
      assert.equal(url.searchParams.get("or"), `(requester_id.eq.${owner},recipient_id.eq.${owner})`);
      const before = url.searchParams.get("id")?.slice(3);
      return json(requests.filter((row) => !before || row.id < before).slice(0, 1));
    }
    const body = JSON.parse(String(init.body)); cursors.push(body.p_before);
    return json(summaries.filter((row) => !body.p_before || row.conversation_id < body.p_before).slice(0, 1));
  });
  const result = await repo.loadConversations(owner);
  assert.deepEqual(result.map((row) => row.id), [id(11), id(10)]);
  assert.deepEqual(cursors, [null, id(11), id(10)]);
  assert.equal(result[1]?.unreadCount, 3);
  assert.equal(result[1]?.lastMessage, "Message chiffré");
  assert.equal(result[1]?.request.message, "");
});

test("preparation encrypts before the RPC; uncertain retries reuse exact ciphertext and nonce", async () => {
  const bodies: Record<string, string>[] = [];
  const repo = repository((url, init) => {
    if (url.pathname.endsWith("messaging_get_peer_key")) return peerResponse();
    assert.equal(url.pathname, "/rest/v1/rpc/messaging_send_message");
    const body = JSON.parse(String(init.body)); bodies.push(body);
    if (bodies.length === 1) return json({ code: "XX000", message: "uncertain delivery" }, 500);
    return json(rawMessage(10, body.p_body, owner, peer, body.p_client_nonce));
  });
  const opened = session();
  const prepared = await repo.prepareMessage(opened, conversation, "  Une phrase strictement privée.  ", id(88));
  assert.doesNotMatch(prepared.ciphertext, /strictement privée/);
  await assert.rejects(repo.sendMessage(opened, prepared));
  const confirmed = await repo.sendMessage(opened, prepared);
  assert.equal(confirmed.body, "Une phrase strictement privée."); assert.equal(confirmed.decrypted, true);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(Object.keys(bodies[0]!).sort(), ["p_body", "p_client_nonce", "p_conversation_id"]);
  assert.equal(bodies[0]?.p_body, prepared.ciphertext);
});

test("history decrypts for the enrolled identity but never renders a clear legacy body or invalid ciphertext", async () => {
  const encrypted = await encryptedIncoming(10, "Contenu authentifié");
  const repo = repository((url) => url.pathname.endsWith("messaging_get_peer_key") ? peerResponse() : json([
    rawMessage(12, "Ancienne présentation en clair à ne pas montrer"), rawMessage(11, encrypted), rawMessage(10, encrypted),
  ]));
  const result = await repo.loadMessagePage(session(), conversation);
  assert.deepEqual(result.map((message) => message.decrypted), [true, false, false]);
  assert.equal(result[0]?.body, "Contenu authentifié");
  assert.equal(result[1]?.body, ""); assert.equal(result[2]?.body, "");
});

test("a wrong local private key cannot decrypt even with a valid account identifier", async () => {
  const impostor = await generateMessagingIdentity(owner);
  const encrypted = await encryptedIncoming(10);
  const repo = repository((url) => url.pathname.endsWith("messaging_get_peer_key") ? peerResponse() : json([rawMessage(10, encrypted)]));
  const result = await repo.loadMessagePage({ userId: owner, identity: impostor.unlocked }, conversation);
  assert.equal(result[0]?.decrypted, false); assert.equal(result[0]?.body, "");
});

test("locking during an outstanding history request prevents plaintext from returning", async () => {
  const encrypted = await encryptedIncoming(10);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const repo = repository(async (url) => {
    if (url.pathname.endsWith("messaging_get_peer_key")) return peerResponse();
    await gate; return json([rawMessage(10, encrypted)]);
  });
  const opened = session(); const pending = repo.loadMessagePage(opened, conversation);
  opened.identity = null; release();
  await assert.rejects(pending, /verrouillée/);
});

test("locked sessions and a recipient without an identity cannot prepare or send messages", async () => {
  let calls = 0;
  const repo = repository(() => { calls++; return json(null); });
  await assert.rejects(repo.prepareMessage({ userId: owner, identity: null }, conversation, "Bonjour", id(88)), /verrouillée/);
  assert.equal(calls, 0);
  await assert.rejects(repo.prepareMessage(session(), conversation, "Bonjour", id(88)), /destinataire/);
  assert.equal(calls, 1);
});

test("read marking contains only exact successfully decrypted incoming IDs, never a sequence range", async () => {
  const visible = (n: number, decrypted = true, senderId = peer, recipientId = owner): ConversationMessage => ({
    id: id(n), sequence: n, conversationId: conversation, senderId, recipientId, body: decrypted ? "Lu" : "", decrypted,
    clientNonce: id(n + 200), createdAt: "2026-10-23T12:00:00Z", readAt: null,
  });
  const repo = repository((url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/messaging_mark_decrypted_read");
    assert.deepEqual(JSON.parse(String(init.body)), { p_conversation_id: conversation, p_message_ids: [id(11)] });
    return json(null);
  });
  await repo.markConversationRead(session(), conversation, [visible(10, false), visible(11), visible(12, true, owner, peer)]);
});

test("sync paginates all ciphertext rows before decrypting, despite a low server cap", async () => {
  const rows = await Promise.all([10, 11, 12].map(async (n) => rawMessage(n, await encryptedIncoming(n))));
  const cursors: string[] = [];
  const repo = repository((url) => {
    if (url.pathname.endsWith("messaging_get_peer_key")) return peerResponse();
    assert.equal(url.searchParams.get("conversation_id"), `eq.${conversation}`);
    const cursor = url.searchParams.get("sequence")!; cursors.push(cursor);
    return json(rows.filter((row) => row.sequence > Number(cursor.slice(3))).slice(0, 1));
  });
  const result = await repo.loadMessagesSince(session(), conversation, 9);
  assert.deepEqual(cursors, ["gt.9", "gt.10", "gt.11", "gt.12"]);
  assert.equal(result.length, 3); assert.equal(result.every((row) => row.decrypted), true);
});

test("invalid IDs and drafts fail before HTTP and unread counts expose no bodies", async () => {
  let calls = 0;
  const repo = repository((url, init) => {
    calls++; assert.equal(init.method, "HEAD");
    assert.equal(url.searchParams.get("recipient_id"), `eq.${owner}`);
    assert.equal(url.searchParams.get("read_at"), "is.null"); assert.equal(url.searchParams.get("select"), "id");
    return new Response(null, { status: 200, headers: { "Content-Range": "*/123" } });
  });
  await assert.rejects(repo.loadConversations("bad-id"));
  await assert.rejects(repo.loadMessagePage(session(), `${conversation},id.neq.null`));
  await assert.rejects(repo.loadMessagesSince(session(), conversation, -1));
  await assert.rejects(repo.prepareMessage(session(), conversation, " ", id(88)));
  await assert.rejects(repo.prepareMessage(session(), conversation, "a".repeat(4001), id(88)));
  assert.equal(calls, 0); assert.equal(await repo.countUnreadMessages(owner), 123);
});

test("enrollment API sends e-mail proof and wrapped identity, never recovery secret or private key", async () => {
  const calls: { url: string; body: unknown; authorization: string | null }[] = [];
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: "test-token" } }, error: null }) } } as unknown as SupabaseClient;
  const repo = createMessagingIdentityRepository(client, "https://api.example/", async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("Authorization") });
    return String(url).endsWith("challenge") ? json({ challengeId: id(99), expiresAt: "2026-10-24T12:10:00Z" }) : new Response(null, { status: 204 });
  });
  const challenge = await repo.requestIdentityChallenge(owner);
  await repo.enrollIdentity(owner, alice.identity, challenge, "12345678");
  assert.equal(calls[0]?.url, "https://api.example/messaging/identity/challenge"); assert.deepEqual(calls[0]?.body, {});
  assert.deepEqual(calls[1]?.body, { challengeId: id(99), code: "12345678", publicKey: alice.identity.public_key, encryptedPrivateKey: alice.identity.encrypted_private_key });
  assert.equal(JSON.stringify(calls).includes(alice.recoverySecret), false);
  assert.equal(calls[1]?.authorization, "Bearer test-token");
  await assert.rejects(repo.requestIdentityChallenge(peer), /session a changé/);
  await assert.rejects(repo.enrollIdentity(owner, alice.identity, challenge, "123456"), /8 chiffres/);
  assert.equal(calls.length, 2);
});

test("preferences preserve false; presence claims no actor and errors redact diagnostics", async () => {
  const writes: { url: string; body: unknown }[] = [];
  const repo = repository((url, init) => {
    if (url.pathname.endsWith("messaging_email_enabled")) return json(false);
    writes.push({ url: url.pathname, body: JSON.parse(String(init.body)) }); return json(null);
  });
  assert.equal(await repo.loadEmailNotifications(), false);
  await repo.saveEmailNotifications(false); await repo.recordMessagingPresence();
  assert.deepEqual(writes, [
    { url: "/rest/v1/rpc/messaging_set_email_enabled", body: { p_enabled: false } },
    { url: "/rest/v1/rpc/messaging_heartbeat", body: {} },
  ]);
  assert.doesNotMatch(repo.getMessagingError({ code: "XX000", message: "private diagnostic" }), /private diagnostic/);
});
