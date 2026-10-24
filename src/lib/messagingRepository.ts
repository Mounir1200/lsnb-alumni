import { supabase } from "./supabase";
import { createMessagingRepository } from "./messagingData";
import { createDeviceManager } from "./messagingDevice";
import { createIndexedDbDeviceStore } from "./messagingDeviceStore";

export type { Conversation, ConversationMessage, MessagingDeviceSummary } from "./messagingData";
export { DeviceAccessError, needsReconnect, type DeviceAccessProblem } from "./messagingDevice";

export const messagingDevice = createDeviceManager(supabase, createIndexedDbDeviceStore());
export const {
  loadConversations, loadMessagePage, loadMessagesSince, sendMessage, markConversationRead, countUnreadMessages,
  recordMessagingPresence, loadEmailNotifications, saveEmailNotifications, loadDevices, revokeDevice, getMessagingError,
} = createMessagingRepository(supabase, messagingDevice);
