import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createMessagingRepository, type ConversationMessage, type MessagingSigner } from "../../../src/lib/messagingData.ts";
import {
  createDeviceManager, createProof, DeviceAccessError, importDeviceKey, needsReconnect, sessionIdFromToken,
  type DeviceStore, type MessagingDevice,
} from "../../../src/lib/messagingDevice.ts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = id(1), peer = id(2), conversation = id(10), session = id(50);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const proof = { issued_at: 1, signature: "c2lnbmF0dXJl" };
const message = (sequence: number, body = `Message ${sequence}`, sender = peer, recipient = owner) => ({
  id: id(sequence + 100), sequence, conversation_id: conversation, sender_id: sender, recipient_id: recipient,
  body, client_nonce: id(sequence + 200), created_at: "2026-10-24T12:00:00Z", read_at: null,
});
const member = (memberId: string) => ({ id: memberId, first_name: "Membre", last_name: "Test", member_role: "alumni",
  graduation_year: 2020, specialty: "Sciences", offers_mentoring: true, photo_url: null });
const request = (value: number) => ({ id: id(value), requester_id: owner, recipient_id: peer,
  request_kind: "contact", status: "accepted", created_at: "2026-10-21T12:00:00Z",
  responded_at: "2026-10-22T12:00:00Z", requester: member(owner), recipient: member(peer), offer_id: null, offer: null });

function recordingSigner() {
  const signed: string[] = [];
  const signer: MessagingSigner = { prove: async (action, payload) => { signed.push(`${action}:${payload}`); return proof; } };
  return { signed, signer };
}

function repository(fetcher: (url: URL, init: RequestInit) => Response | Promise<Response>, signer = recordingSigner().signer) {
  const client = createClient("https://database.example", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => fetcher(new URL(String(input)), init ?? {}) },
  });
  return createMessagingRepository(client, signer);
}

test("inbox paginates under a low row cap, signs each page and never fetches introduction text", async () => {
  const requests = [request(11), request(10)];
  const summaries = [11, 10].map((value) => ({ conversation_id: id(value), last_message_preview: value === 10 ? "Dernier mot" : null,
    last_message_at: `2026-10-${value + 10}T13:00:00Z`, last_sequence: value === 10 ? 4 : null, unread_count: value === 10 ? 3 : 0 }));
  const { signed, signer } = recordingSigner();
  const repo = repository((url, init) => {
    if (url.pathname.endsWith("connection_requests")) {
      assert.doesNotMatch(url.searchParams.get("select")!, /\bmessage\b/);
      const before = url.searchParams.get("id")?.slice(3);
      return json(requests.filter((row) => !before || row.id < before).slice(0, 1));
    }
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.p_proof, proof);
    return json(summaries.filter((row) => !body.p_before || row.conversation_id < body.p_before).slice(0, 1));
  }, signer);
  const result = await repo.loadConversations(owner);
  assert.deepEqual(result.map((row) => row.id), [id(11), id(10)]);
  assert.deepEqual(signed, ["list:|100", `list:${id(11)}|100`, `list:${id(10)}|100`]);
  assert.equal(result[1]?.lastMessage, "Dernier mot"); assert.equal(result[1]?.unreadCount, 3);
  assert.equal(result[0]?.lastMessage, "Conversation ouverte");
  assert.equal(result[1]?.request.message, "");
});

test("sending signs the exact text it sends, and an uncertain retry repeats the same nonce and text", async () => {
  const bodies: Record<string, unknown>[] = [];
  const { signed, signer } = recordingSigner();
  const repo = repository((url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/messaging_send_message");
    const body = JSON.parse(String(init.body)); bodies.push(body);
    if (bodies.length === 1) return json({ code: "XX000", message: "uncertain delivery" }, 500);
    return json(message(10, body.p_body as string, owner, peer));
  }, signer);
  await assert.rejects(repo.sendMessage(conversation, "  Une phrase privée.  ", id(88)));
  const confirmed = await repo.sendMessage(conversation, "  Une phrase privée.  ", id(88));
  assert.equal(confirmed.body, "Une phrase privée.");
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(Object.keys(bodies[0]!).sort(), ["p_body", "p_client_nonce", "p_conversation_id", "p_proof"]);
  assert.deepEqual(signed, [`send:${conversation}|${id(88)}|Une phrase privée.`, `send:${conversation}|${id(88)}|Une phrase privée.`]);
});

test("history and sync pages carry their cursor in the signed text", async () => {
  const rows = [10, 11, 12].map((sequence) => message(sequence));
  const { signed, signer } = recordingSigner();
  const repo = repository((_url, init) => {
    const body = JSON.parse(String(init.body));
    if (body.p_after === null) return json([...rows].reverse());
    return json(rows.filter((row) => row.sequence > body.p_after).slice(0, 1));
  }, signer);
  assert.deepEqual((await repo.loadMessagePage(conversation)).map((row) => row.sequence), [10, 11, 12]);
  assert.equal((await repo.loadMessagesSince(conversation, 9)).length, 3);
  assert.deepEqual(signed, [`messages:${conversation}|||50`, `messages:${conversation}||9|100`, `messages:${conversation}||10|100`,
    `messages:${conversation}||11|100`, `messages:${conversation}||12|100`]);
});

test("read receipts name exact unread incoming messages, never a range", async () => {
  const shown = (n: number, senderId = peer, recipientId = owner, readAt: string | null = null): ConversationMessage => ({
    id: id(n), sequence: n, conversationId: conversation, senderId, recipientId, body: "Lu", clientNonce: id(n + 200),
    createdAt: "2026-10-24T12:00:00Z", readAt,
  });
  const repo = repository((url, init) => {
    assert.equal(url.pathname, "/rest/v1/rpc/messaging_mark_read");
    assert.deepEqual(JSON.parse(String(init.body)), { p_conversation_id: conversation, p_message_ids: [id(11)], p_proof: proof });
    return json(null);
  });
  await repo.markConversationRead(owner, conversation, [shown(10, peer, owner, "2026-10-24T12:01:00Z"), shown(11), shown(12, owner, peer)]);
});

test("invalid identifiers and drafts fail before any signature or request", async () => {
  let calls = 0;
  const { signed, signer } = recordingSigner();
  const repo = repository(() => { calls++; return json(null); }, signer);
  await assert.rejects(repo.loadConversations("bad-id"));
  await assert.rejects(repo.loadMessagePage(`${conversation},id.neq.null`));
  await assert.rejects(repo.loadMessagesSince(conversation, -1));
  await assert.rejects(repo.sendMessage(conversation, " ", id(88)));
  await assert.rejects(repo.sendMessage(conversation, "a".repeat(4001), id(88)));
  assert.equal(calls, 0); assert.deepEqual(signed, []);
});

test("a rejected device asks for a new sign-in, while other errors stay generic", () => {
  const repo = repository(() => json(null));
  for (const code of ["LS401", "LS403", "LS428"]) {
    assert.equal(needsReconnect({ code }), true);
    assert.match(repo.getMessagingError({ code }), /Reconnectez-vous/);
  }
  assert.equal(needsReconnect({ code: "54000" }), false);
  assert.doesNotMatch(repo.getMessagingError({ code: "XX000", message: "private diagnostic" }), /private diagnostic/);
});

const token = (claims: Record<string, unknown>) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const rawKey = Buffer.alloc(32, 7).toString("base64");

function memoryStore(initial: MessagingDevice[] = []): DeviceStore & { devices: Map<string, MessagingDevice> } {
  const devices = new Map(initial.map((device) => [device.userId, device]));
  return { devices, load: async (userId) => devices.get(userId) ?? null, save: async (device) => { devices.set(device.userId, device); }, clear: async () => devices.clear() };
}

function authClient(sessionId: string | null, register: () => { data: unknown; error: unknown }) {
  let registrations = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: sessionId ? { user: { id: owner }, access_token: token({ session_id: sessionId }) } : null }, error: null }) },
    rpc: async (name: string) => { assert.equal(name, "messaging_register_device"); registrations++; return register(); },
  } as unknown as SupabaseClient;
  return { client, registrations: () => registrations };
}

test("the session identifier is read from the access token, and bad tokens yield nothing", () => {
  assert.equal(sessionIdFromToken(token({ session_id: session })), session);
  assert.equal(sessionIdFromToken(token({ sub: owner })), null);
  assert.equal(sessionIdFromToken("not-a-token"), null);
});

test("a device registers once per sign-in, is reused from storage, and never keeps the raw key", async () => {
  const store = memoryStore();
  const { client, registrations } = authClient(session, () => ({ data: { session_id: session, key: rawKey, server_time: Date.now() }, error: null }));
  const manager = createDeviceManager(client, store, async () => undefined);
  const device = await manager.ensureDevice();
  assert.equal(device.sessionId, session); assert.equal(device.key.extractable, false);
  await manager.ensureDevice();
  assert.equal(registrations(), 1);
  const reloaded = createDeviceManager(client, store, async () => undefined);
  assert.equal((await reloaded.ensureDevice()).key, device.key);
  assert.equal(registrations(), 1);
  assert.equal(JSON.stringify([...store.devices.values()]).includes(rawKey), false);
});

test("an existing device of another tab is reused; otherwise an old or reused sign-in asks to reconnect", async () => {
  const shared = { userId: owner, sessionId: session, key: await importDeviceKey(rawKey), clockOffset: 0 };
  const store = memoryStore();
  const tab = authClient(session, () => { void store.save(shared); return { data: null, error: { code: "LS409" } }; });
  assert.equal(await createDeviceManager(tab.client, store, async () => undefined).ensureDevice(), shared);
  for (const code of ["LS409", "LS428", "LS401"]) {
    const { client } = authClient(session, () => ({ data: null, error: { code } }));
    await assert.rejects(createDeviceManager(client, memoryStore(), async () => undefined).ensureDevice(),
      (error: unknown) => error instanceof DeviceAccessError && error.problem === "reconnect");
  }
  const offline = authClient(session, () => ({ data: null, error: { code: "PGRST000" } }));
  await assert.rejects(createDeviceManager(offline.client, memoryStore(), async () => undefined).ensureDevice(),
    (error: unknown) => error instanceof DeviceAccessError && error.problem === "unavailable");
  const signedOut = authClient(null, () => ({ data: null, error: null }));
  await assert.rejects(createDeviceManager(signedOut.client, memoryStore(), async () => undefined).ensureDevice(),
    (error: unknown) => error instanceof DeviceAccessError && error.problem === "reconnect");
});

test("a proof is an HMAC of the version, action, sign-in, corrected time and arguments", async () => {
  const device = { userId: owner, sessionId: session, key: await importDeviceKey(rawKey), clockOffset: 1500 };
  const signed = await createProof(device, "send", `${conversation}|${id(88)}|Bonjour`, 1_000_000);
  assert.equal(signed.issued_at, 1_001_500);
  const verifier = await crypto.subtle.importKey("raw", Buffer.from(rawKey, "base64"), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const expected = new TextEncoder().encode(`lsnb-messaging-v1|send|${session}|1001500|${conversation}|${id(88)}|Bonjour`);
  assert.equal(await crypto.subtle.verify("HMAC", verifier, Buffer.from(signed.signature, "base64"), expected), true);
});
