import { supabase } from "./supabase";
import { createMessagingRepository } from "./messagingData";

export type { Conversation, ConversationMessage, MessagingSession, PreparedEncryptedMessage, PeerMessagingKey } from "./messagingData";
export const {
  loadConversations, loadMessagePage, loadMessagesSince, loadPeerMessagingKey, prepareMessage, sendMessage, markConversationRead, countUnreadMessages,
  recordMessagingPresence, loadEmailNotifications, saveEmailNotifications, getMessagingError,
} = createMessagingRepository(supabase);
