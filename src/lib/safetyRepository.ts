import { supabase } from "./supabase";
import { createSafetyRepository } from "./safetyData";

export type { BlockedMember } from "./safetyData";

export const { blockMember, unblockMember, hasBlocked, loadBlockedMembers, reportMember, getSafetyErrorMessage } = createSafetyRepository(supabase);
