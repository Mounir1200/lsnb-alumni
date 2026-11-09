import { supabase } from "./supabase";
import { createSafetyRepository } from "./safetyData";

export type { BlockedMember } from "./safetyData";

export const { blockMember, unblockMember, hasBlocked, loadBlockedMembers, getSafetyErrorMessage } = createSafetyRepository(supabase);
