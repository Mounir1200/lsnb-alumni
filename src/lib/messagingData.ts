import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionRequest } from "./mentorshipData";
import { mapMemberSummary, memberColumns, type MemberRow } from "./memberSummary";
import { collectRowsById, isUuid } from "./pagedRows";
import { decryptMessage, encryptMessage, isEncryptedMessage, type UnlockedMessagingIdentity } from "./messagingCrypto";

export type MessagingSession = { userId: string; identity: UnlockedMessagingIdentity | null };
export type PreparedEncryptedMessage = { conversationId: string; senderId: string; recipientId: string; clientNonce: string; ciphertext: string; peerPublicKey: string };
export type PeerMessagingKey = { user_id: string; public_key: string };

export type ConversationMessage = {
  id: string;
  sequence: number;
  conversationId: string;
  senderId: string;
  recipientId: string;
  body: string;
  decrypted: boolean;
  clientNonce: string;
  createdAt: string;
  readAt: string | null;
};

export type Conversation = {
  id: string;
  request: ConnectionRequest;
  lastMessage: string;
  updatedAt: string;
  unreadCount: number;
};

export type MessageRow = {
  id: string; sequence: number; conversation_id: string; sender_id: string;
  recipient_id: string; body: string; client_nonce: string; created_at: string; read_at: string | null;
};

type ConversationSummaryRow = {
  conversation_id: string; last_message_body: string | null; last_message_at: string | null;
  last_sequence: number | null; unread_count: number;
};

class MessagingActionError extends Error {}

function checkedId(id: string) {
  if (!isUuid(id)) throw new MessagingActionError("Cette conversation est introuvable.");
  return id;
}

function messageMetadata(row: MessageRow): Omit<ConversationMessage, "body" | "decrypted"> {
  return {
    id: row.id, sequence: Number(row.sequence), conversationId: row.conversation_id,
    senderId: row.sender_id, recipientId: row.recipient_id,
    clientNonce: row.client_nonce, createdAt: row.created_at, readAt: row.read_at,
  };
}

function unlocked(session: MessagingSession) {
  if (!session.identity || session.identity.userId !== session.userId) throw new MessagingActionError("Votre messagerie est verrouillée.");
  return session.identity;
}

type InboxRequestRow = {
  id: string; requester_id: string; recipient_id: string; request_kind: "contact" | "mentoring";
  created_at: string; responded_at: string | null; offer_id: string | null;
  requester: MemberRow | null; recipient: MemberRow | null; offer: { id: string; title: string } | null;
};

export function createMessagingRepository(supabase: SupabaseClient | null) {
  function client() {
    if (!supabase) throw new MessagingActionError("La messagerie est indisponible pour le moment.");
    return supabase;
  }

  async function loadConversations(userId: string): Promise<Conversation[]> {
    checkedId(userId);
    // The legacy introduction belongs to Relations. Never fetch its clear text here.
    const requests = (await collectRowsById((before) => {
      let query = client().from("connection_requests").select(`id, requester_id, recipient_id, request_kind, created_at, responded_at, offer_id,
        requester:profiles!connection_requests_requester_id_fkey(${memberColumns}),
        recipient:profiles!connection_requests_recipient_id_fkey(${memberColumns}),offer:offers!connection_requests_offer_id_fkey(id,title)`)
        .eq("status", "accepted").or(`requester_id.eq.${userId},recipient_id.eq.${userId}`).order("id", { ascending: false }).limit(100);
      if (before) query = query.lt("id", before);
      return query;
    }) as unknown as InboxRequestRow[]).map((row): ConnectionRequest => ({
      id: row.id, requesterId: row.requester_id, recipientId: row.recipient_id, kind: row.request_kind, status: "accepted", message: "",
      createdAt: row.created_at, respondedAt: row.responded_at, offerId: row.offer_id, offer: row.offer,
      requester: mapMemberSummary(row.requester), recipient: mapMemberSummary(row.recipient),
    }));
    const summaries = new Map<string, ConversationSummaryRow>();
    let before: string | null = null;
    // Continue until empty: the project can impose a row cap below our page size.
    for (;;) {
      const { data, error } = await client().rpc("messaging_list_conversations", { p_before: before, p_limit: 100 });
      if (error) throw error;
      const rows = (data ?? []) as ConversationSummaryRow[];
      if (!rows.length) break;
      for (const row of rows) summaries.set(row.conversation_id, row);
      const next = rows[rows.length - 1]!.conversation_id;
      if (!isUuid(next) || (before && next >= before)) throw new MessagingActionError("Impossible de charger toutes les conversations. Réessayez.");
      before = next;
    }
    return requests.map((request) => {
      const summary = summaries.get(request.id);
      return {
        id: request.id, request, lastMessage: summary?.last_sequence ? "Message chiffré" : "Conversation chiffrée ouverte",
        updatedAt: summary?.last_message_at ?? request.respondedAt ?? request.createdAt,
        unreadCount: Number(summary?.unread_count ?? 0),
      };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  }

  async function loadPeerMessagingKey(conversationId: string): Promise<PeerMessagingKey | null> {
    const { data, error } = await client().rpc("messaging_get_peer_key", { p_conversation_id: checkedId(conversationId) });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) ?? null;
  }

  async function decryptRows(session: MessagingSession, rows: MessageRow[], peerKey: PeerMessagingKey | null): Promise<ConversationMessage[]> {
    const identity = unlocked(session);
    const messages: ConversationMessage[] = [];
    for (const row of rows) {
      let body = "";
      let decrypted = false;
      if (peerKey && isEncryptedMessage(row.body)) {
        try {
          body = await decryptMessage(identity, peerKey.public_key, {
            conversationId: row.conversation_id, senderId: row.sender_id, recipientId: row.recipient_id, clientNonce: row.client_nonce,
          }, row.body);
          decrypted = true;
        } catch { /* Corrupted, legacy or wrong-key content is never rendered or marked read. */ }
      }
      if (unlocked(session) !== identity) throw new MessagingActionError("Votre messagerie est verrouillée.");
      messages.push({ ...messageMetadata(row), body, decrypted });
    }
    return messages;
  }

  async function loadMessagePage(session: MessagingSession, conversationId: string, before?: number): Promise<ConversationMessage[]> {
    unlocked(session);
    checkedId(conversationId);
    if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) throw new MessagingActionError("La page de messages est invalide.");
    let query = client().from("conversation_messages")
      .select("id, sequence, conversation_id, sender_id, recipient_id, body, client_nonce, created_at, read_at")
      .eq("conversation_id", conversationId).order("sequence", { ascending: false }).limit(50);
    if (before !== undefined) query = query.lt("sequence", before);
    const { data, error } = await query;
    if (error) throw error;
    return (await decryptRows(session, (data ?? []) as MessageRow[], await loadPeerMessagingKey(conversationId))).reverse();
  }

  async function prepareMessage(session: MessagingSession, conversationId: string, body: string, nonce: string): Promise<PreparedEncryptedMessage> {
    const identity = unlocked(session);
    checkedId(conversationId);
    checkedId(nonce);
    const content = body.trim();
    if (!content || [...content].length > 4000) throw new MessagingActionError("Votre message doit contenir entre 1 et 4 000 caractères.");
    const peer = await loadPeerMessagingKey(conversationId);
    if (!peer) throw new MessagingActionError("Votre destinataire doit d’abord activer sa messagerie chiffrée.");
    if (unlocked(session) !== identity) throw new MessagingActionError("Votre messagerie est verrouillée.");
    const context = { conversationId, senderId: session.userId, recipientId: peer.user_id, clientNonce: nonce };
    const ciphertext = await encryptMessage(identity, peer.public_key, context, content);
    if (unlocked(session) !== identity) throw new MessagingActionError("Votre messagerie est verrouillée.");
    return { ...context, ciphertext, peerPublicKey: peer.public_key };
  }

  async function sendMessage(session: MessagingSession, prepared: PreparedEncryptedMessage): Promise<ConversationMessage> {
    const identity = unlocked(session);
    if (prepared.senderId !== session.userId || !isEncryptedMessage(prepared.ciphertext)) throw new MessagingActionError("Le message chiffré est invalide.");
    const { data, error } = await client().rpc("messaging_send_message", {
      p_conversation_id: checkedId(prepared.conversationId), p_body: prepared.ciphertext, p_client_nonce: checkedId(prepared.clientNonce),
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as MessageRow | undefined;
    if (!row?.id) throw new MessagingActionError("L’envoi n’a pas été confirmé. Réessayez sans fermer la conversation.");
    if (unlocked(session) !== identity) throw new MessagingActionError("Votre messagerie est verrouillée.");
    const result = await decryptRows(session, [row], { user_id: prepared.recipientId, public_key: prepared.peerPublicKey });
    if (!result[0]?.decrypted) throw new MessagingActionError("Le message a été envoyé mais sa lecture n’a pas pu être vérifiée. Actualisez la conversation.");
    return result[0];
  }

  async function loadMessagesSince(session: MessagingSession, conversationId: string, after: number): Promise<ConversationMessage[]> {
    unlocked(session);
    checkedId(conversationId);
    if (!Number.isSafeInteger(after) || after < 0) throw new MessagingActionError("Le repère de messages est invalide.");
    const rows: MessageRow[] = [];
    let cursor = after;
    for (;;) {
      const { data, error } = await client().from("conversation_messages")
        .select("id, sequence, conversation_id, sender_id, recipient_id, body, client_nonce, created_at, read_at")
        .eq("conversation_id", conversationId).gt("sequence", cursor).order("sequence", { ascending: true }).limit(100);
      if (error) throw error;
      const page = (data ?? []) as MessageRow[];
      if (!page.length) return decryptRows(session, rows, await loadPeerMessagingKey(conversationId));
      const next = page[page.length - 1]!.sequence;
      if (!Number.isSafeInteger(next) || next <= cursor) throw new MessagingActionError("Impossible de synchroniser les messages. Réessayez.");
      rows.push(...page);
      unlocked(session);
      cursor = next;
    }
  }

  async function markConversationRead(session: MessagingSession, conversationId: string, messages: ConversationMessage[]) {
    unlocked(session);
    checkedId(conversationId);
    const ids = messages.filter((message) => message.decrypted && !message.readAt && message.recipientId === session.userId && message.conversationId === conversationId).map((message) => checkedId(message.id));
    for (let index = 0; index < ids.length; index += 100) {
      unlocked(session);
      const { error } = await client().rpc("messaging_mark_decrypted_read", { p_conversation_id: conversationId, p_message_ids: ids.slice(index, index + 100) });
      if (error) throw error;
    }
  }

  async function countUnreadMessages(userId: string) {
    const { count, error } = await client().from("conversation_messages")
      .select("id", { head: true, count: "exact" }).eq("recipient_id", checkedId(userId)).is("read_at", null);
    if (error) throw error;
    return count ?? 0;
  }

  async function recordMessagingPresence() {
    const { error } = await client().rpc("messaging_heartbeat");
    if (error) throw error;
  }

  async function loadEmailNotifications(): Promise<boolean> {
    const { data, error } = await client().rpc("messaging_email_enabled");
    if (error) throw error;
    if (typeof data !== "boolean") throw new MessagingActionError("Impossible de charger votre préférence e-mail.");
    return data;
  }

  async function saveEmailNotifications(enabled: boolean) {
    const { error } = await client().rpc("messaging_set_email_enabled", { p_enabled: enabled });
    if (error) throw error;
  }

  function getMessagingError(error: unknown) {
    if (error instanceof MessagingActionError) return error.message;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "54000") return "Vous avez envoyé beaucoup de messages. Patientez une minute avant de réessayer ; votre texte est conservé.";
    if (code === "42501") return "Cette conversation n’est plus accessible. Vérifiez votre connexion et l’état de votre relation.";
    if (["P0001", "23514", "22023"].includes(code)) return "Ce message ne peut pas être envoyé. Vérifiez sa longueur et l’état de votre relation.";
    return "La messagerie ne répond pas. Votre texte est conservé : réessayez dans un instant.";
  }

  return { loadConversations, loadMessagePage, loadMessagesSince, loadPeerMessagingKey, prepareMessage, sendMessage, markConversationRead, countUnreadMessages,
    recordMessagingPresence, loadEmailNotifications, saveEmailNotifications, getMessagingError };
}
