import type { SupabaseClient } from "@supabase/supabase-js";
import { errorCode } from "./errorCode";
import { mapMemberSummary, memberColumns, type MemberRow, type MemberSummary } from "./memberSummary";
import { isUuid } from "./pagedRows";
import { SELF_TARGETED } from "./safety";

/** A member the signed-in member blocked. `member` is null once that profile is no longer visible. */
export type BlockedMember = { memberId: string; blockedAt: string; member: MemberSummary | null };

export class SafetyActionError extends Error {}

type BlockRow = { blocked_id: string; created_at: string; blocked: MemberRow | null };

const SAFETY_ERRORS: Record<string, string> = {
  P0002: "Ce membre est introuvable.",
  "42501": "Cette action n’est pas autorisée. Vérifiez votre connexion et l’état de votre compte.",
  [SELF_TARGETED]: "Vous ne pouvez pas vous signaler ni vous bloquer vous-même.",
};

export function createSafetyRepository(supabase: SupabaseClient | null) {
  function client() {
    if (!supabase) throw new SafetyActionError("Cette action est indisponible pour le moment.");
    return supabase;
  }

  function checkedId(id: string) {
    // Identifiers end up in PostgREST filters; refuse anything else before the request.
    if (!isUuid(id)) throw new SafetyActionError("Ce membre est introuvable.");
    return id;
  }

  /** Blocks the member; the database also ends every link between the two of them. */
  async function blockMember(memberId: string) {
    const { error } = await client().rpc("block_member", { p_member_id: checkedId(memberId) });
    if (error) throw error;
  }

  /** Row security limits the delete to the signed-in member's own block. */
  async function unblockMember(memberId: string) {
    const { error } = await client().from("member_blocks").delete().eq("blocked_id", checkedId(memberId));
    if (error) throw error;
  }

  async function hasBlocked(memberId: string) {
    const { data, error } = await client().from("member_blocks").select("blocked_id").eq("blocked_id", checkedId(memberId));
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async function loadBlockedMembers(): Promise<BlockedMember[]> {
    const { data, error } = await client().from("member_blocks")
      .select(`blocked_id, created_at, blocked:profiles!member_blocks_blocked_id_fkey(${memberColumns})`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as BlockRow[]).map((row) => ({
      memberId: row.blocked_id, blockedAt: row.created_at, member: mapMemberSummary(row.blocked),
    }));
  }

  function getSafetyErrorMessage(error: unknown): string {
    if (error instanceof SafetyActionError) return error.message;
    return SAFETY_ERRORS[errorCode(error)] ?? "L’action n’a pas abouti. Réessayez dans un instant.";
  }

  return { blockMember, unblockMember, hasBlocked, loadBlockedMembers, getSafetyErrorMessage };
}
