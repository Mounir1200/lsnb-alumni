import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionRequest } from "./mentorshipData";
import { mapMemberSummary, memberColumns, type MemberRow } from "./memberSummary";
import { collectRowsById, isUuid } from "./pagedRows";
import { errorCode, needsReconnect, DeviceAccessError, type MessagingProof } from "./messagingDevice";

export type ConversationMessage = {
  id: string;
  sequence: number;
  conversationId: string;
  senderId: string;
  recipientId: string;
  body: string;
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

export type MessagingDeviceSummary = {
  sessionId: string;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
};

/** Signs a call with this browser's device key; see messagingDevice.ts. */
export type MessagingSigner = { prove(action: string, payload: string): Promise<MessagingProof> };

type MessageRow = {
  id: string; sequence: number; conversation_id: string; sender_id: string;
  recipient_id: string; body: string; client_nonce: string; created_at: string; read_at: string | null;
};

type ConversationSummaryRow = {
  conversation_id: string; last_message_preview: string | null; last_message_at: string | null;
  last_sequence: number | null; unread_count: number;
};

type DeviceRow = { session_id: string; user_agent: string | null; created_at: string; last_used_at: string; is_current: boolean };

type InboxRequestRow = {
  id: string; requester_id: string; recipient_id: string; request_kind: "contact" | "mentoring";
  created_at: string; responded_at: string | null; offer_id: string | null;
  requester: MemberRow | null; recipient: MemberRow | null; offer: { id: string; title: string } | null;
};

type SignedCall = readonly [action: string, payload: string];

const HISTORY_PAGE_SIZE = 50;
const SYNC_PAGE_SIZE = 100;
const LIST_PAGE_SIZE = 100;
const READ_RECEIPT_BATCH = 100;
const MAX_MESSAGE_LENGTH = 4000;

/**
 * The action and exact argument text of each call. The database rebuilds the same text and
 * checks the signature against it, so a proof made for one call cannot authorize another.
 */
export const signedCalls = {
  send: (conversationId: string, clientNonce: string, body: string): SignedCall => ["send", `${conversationId}|${clientNonce}|${body}`],
  messages: (conversationId: string, before: number | null, after: number | null, limit: number): SignedCall =>
    ["messages", `${conversationId}|${before ?? ""}|${after ?? ""}|${limit}`],
  list: (before: string | null, limit: number): SignedCall => ["list", `${before ?? ""}|${limit}`],
  read: (conversationId: string, messageIds: string[]): SignedCall => ["read", `${conversationId}|${messageIds.join(",")}`],
  unread: (): SignedCall => ["unread", ""],
  heartbeat: (): SignedCall => ["heartbeat", ""],
  email: (): SignedCall => ["email", ""],
  emailSet: (enabled: boolean): SignedCall => ["email-set", String(enabled)],
  devices: (): SignedCall => ["devices", ""],
  revoke: (sessionId: string): SignedCall => ["revoke", sessionId],
};

class MessagingActionError extends Error {}

function checkedId(id: string) {
  if (!isUuid(id)) throw new MessagingActionError("Cette conversation est introuvable.");
  return id.toLowerCase();
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id, sequence: Number(row.sequence), conversationId: row.conversation_id,
    senderId: row.sender_id, recipientId: row.recipient_id, body: row.body,
    clientNonce: row.client_nonce, createdAt: row.created_at, readAt: row.read_at,
  };
}

export function createMessagingRepository(supabase: SupabaseClient | null, signer: MessagingSigner) {
  function client() {
    if (!supabase) throw new MessagingActionError("La messagerie est indisponible pour le moment.");
    return supabase;
  }

  async function signedRpc<T>(name: string, [action, payload]: SignedCall, args: Record<string, unknown> = {}): Promise<T> {
    const proof = await signer.prove(action, payload);
    const { data, error } = await client().rpc(name, { ...args, p_proof: proof });
    if (error) throw error;
    return data as T;
  }

  async function loadConversations(userId: string): Promise<Conversation[]> {
    checkedId(userId);
    // The introduction text belongs to Relations. Never fetch it here.
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
      const rows: ConversationSummaryRow[] = await signedRpc<ConversationSummaryRow[] | null>("messaging_list_conversations",
        signedCalls.list(before, LIST_PAGE_SIZE), { p_before: before, p_limit: LIST_PAGE_SIZE }) ?? [];
      if (!rows.length) break;
      for (const row of rows) summaries.set(row.conversation_id, row);
      const next: string = rows[rows.length - 1]!.conversation_id;
      if (!isUuid(next) || (before && next >= before)) throw new MessagingActionError("Impossible de charger toutes les conversations. Réessayez.");
      before = next;
    }
    return requests.map((request) => {
      const summary = summaries.get(request.id);
      return {
        id: request.id, request, lastMessage: summary?.last_message_preview ?? "Conversation ouverte",
        updatedAt: summary?.last_message_at ?? request.respondedAt ?? request.createdAt,
        unreadCount: Number(summary?.unread_count ?? 0),
      };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  }

  async function loadMessagePage(conversationId: string, before?: number): Promise<ConversationMessage[]> {
    const id = checkedId(conversationId);
    if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) throw new MessagingActionError("La page de messages est invalide.");
    const cursor = before ?? null;
    const rows = await signedRpc<MessageRow[] | null>("messaging_get_messages", signedCalls.messages(id, cursor, null, HISTORY_PAGE_SIZE),
      { p_conversation_id: id, p_before: cursor, p_after: null, p_limit: HISTORY_PAGE_SIZE }) ?? [];
    return rows.map(toMessage).reverse();
  }

  async function loadMessagesSince(conversationId: string, after: number): Promise<ConversationMessage[]> {
    const id = checkedId(conversationId);
    if (!Number.isSafeInteger(after) || after < 0) throw new MessagingActionError("Le repère de messages est invalide.");
    const messages: ConversationMessage[] = [];
    let cursor = after;
    for (;;) {
      const page = (await signedRpc<MessageRow[] | null>("messaging_get_messages", signedCalls.messages(id, null, cursor, SYNC_PAGE_SIZE),
        { p_conversation_id: id, p_before: null, p_after: cursor, p_limit: SYNC_PAGE_SIZE }) ?? []).map(toMessage);
      if (!page.length) return messages;
      const next = page[page.length - 1]!.sequence;
      if (!Number.isSafeInteger(next) || next <= cursor) throw new MessagingActionError("Impossible de synchroniser les messages. Réessayez.");
      messages.push(...page);
      cursor = next;
    }
  }

  /** The same nonce for a retry lets the database recognize a message it already saved. */
  async function sendMessage(conversationId: string, body: string, clientNonce: string): Promise<ConversationMessage> {
    const id = checkedId(conversationId);
    const nonce = checkedId(clientNonce);
    const content = body.trim();
    if (!content || [...content].length > MAX_MESSAGE_LENGTH) throw new MessagingActionError("Votre message doit contenir entre 1 et 4 000 caractères.");
    const row = await signedRpc<MessageRow | null>("messaging_send_message", signedCalls.send(id, nonce, content),
      { p_conversation_id: id, p_body: content, p_client_nonce: nonce });
    if (!row?.id) throw new MessagingActionError("L’envoi n’a pas été confirmé. Réessayez sans fermer la conversation.");
    return toMessage(row);
  }

  async function markConversationRead(userId: string, conversationId: string, messages: ConversationMessage[]) {
    const id = checkedId(conversationId);
    const ids = messages.filter((message) => !message.readAt && message.recipientId === userId && message.conversationId === id)
      .map((message) => checkedId(message.id));
    for (let index = 0; index < ids.length; index += READ_RECEIPT_BATCH) {
      const batch = ids.slice(index, index + READ_RECEIPT_BATCH);
      await signedRpc("messaging_mark_read", signedCalls.read(id, batch), { p_conversation_id: id, p_message_ids: batch });
    }
  }

  async function countUnreadMessages() {
    return Number(await signedRpc<number | null>("messaging_unread_count", signedCalls.unread()) ?? 0);
  }

  async function recordMessagingPresence() {
    await signedRpc("messaging_heartbeat", signedCalls.heartbeat());
  }

  async function loadEmailNotifications(): Promise<boolean> {
    const enabled = await signedRpc<unknown>("messaging_email_enabled", signedCalls.email());
    if (typeof enabled !== "boolean") throw new MessagingActionError("Impossible de charger votre préférence e-mail.");
    return enabled;
  }

  async function saveEmailNotifications(enabled: boolean) {
    await signedRpc("messaging_set_email_enabled", signedCalls.emailSet(enabled), { p_enabled: enabled });
  }

  async function loadDevices(): Promise<MessagingDeviceSummary[]> {
    const rows = await signedRpc<DeviceRow[] | null>("messaging_list_devices", signedCalls.devices()) ?? [];
    return rows.map((row) => ({
      sessionId: row.session_id, userAgent: row.user_agent ?? "", createdAt: row.created_at,
      lastUsedAt: row.last_used_at, isCurrent: row.is_current,
    }));
  }

  async function revokeDevice(sessionId: string) {
    const id = checkedId(sessionId);
    await signedRpc("messaging_revoke_device", signedCalls.revoke(id), { p_session_id: id });
  }

  function getMessagingError(error: unknown) {
    if (error instanceof MessagingActionError || error instanceof DeviceAccessError) return error.message;
    if (needsReconnect(error)) return new DeviceAccessError("reconnect").message;
    const code = errorCode(error);
    if (code === "54000") return "Vous avez envoyé beaucoup de messages. Patientez une minute avant de réessayer ; votre texte est conservé.";
    if (code === "42501") return "Cette conversation n’est plus accessible. Vérifiez votre connexion et l’état de votre relation.";
    if (["P0001", "23514", "22023"].includes(code)) return "Ce message ne peut pas être envoyé. Vérifiez sa longueur et l’état de votre relation.";
    return "La messagerie ne répond pas. Votre texte est conservé : réessayez dans un instant.";
  }

  return { loadConversations, loadMessagePage, loadMessagesSince, sendMessage, markConversationRead, countUnreadMessages,
    recordMessagingPresence, loadEmailNotifications, saveEmailNotifications, loadDevices, revokeDevice, getMessagingError };
}
