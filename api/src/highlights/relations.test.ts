import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionRequest } from "../../../src/lib/mentorshipData.ts";
import { peerConnectionStatus, requestedKinds, requestKindLabel } from "../../../src/lib/relations.ts";

const me = "11111111-1111-4111-8111-111111111111";
const them = "22222222-2222-4222-8222-222222222222";

function request(changes: Partial<ConnectionRequest>): ConnectionRequest {
  return {
    id: "33333333-3333-4333-8333-333333333333", requesterId: me, recipientId: them, kind: "connection", status: "pending",
    message: "Bonjour, je souhaite rejoindre votre réseau.", createdAt: "2026-11-05T10:00:00Z", respondedAt: null,
    requester: null, recipient: null, offerId: null, offer: null, ...changes,
  };
}

test("a connection reads as connected, sent, received or not yet asked", () => {
  assert.equal(peerConnectionStatus(me, [], true), "connected");
  assert.equal(peerConnectionStatus(me, [request({})], false), "sent");
  assert.equal(peerConnectionStatus(me, [request({ requesterId: them, recipientId: me })], false), "received");
  assert.equal(peerConnectionStatus(me, [], false), "none");
});

test("only pending connection requests matter, not mentoring or answered ones", () => {
  const others = [
    request({ kind: "mentoring" }),
    request({ status: "declined" }),
    request({ status: "accepted" }),
  ];
  assert.equal(peerConnectionStatus(me, others, false), "none");
});

test("each request kind has its own label, offer questions first", () => {
  assert.equal(requestKindLabel(request({})), "Demande de connexion");
  assert.equal(requestKindLabel(request({ kind: "mentoring" })), "Demande de mentorat");
  assert.equal(requestKindLabel(request({ kind: "contact" })), "Demande d’échange");
  assert.equal(requestKindLabel(request({ kind: "contact", offerId: "44444444-4444-4444-8444-444444444444" })), "Question sur une offre");
});

test("asking for mentoring also asks to connect; asking to connect asks for nothing else", () => {
  assert.deepEqual(requestedKinds("mentoring"), ["connection", "mentoring"]);
  assert.deepEqual(requestedKinds("connection"), ["connection"]);
});
