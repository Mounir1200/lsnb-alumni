import type { SupabaseClient } from "@supabase/supabase-js";
import { errorCode } from "./errorCode";
import { mapMemberSummary, memberColumns, type MemberRow, type MemberSummary } from "./memberSummary";
import { DeviceAccessError } from "./messagingDevice";
import { isUuid } from "./pagedRows";
import { reportProblem, SELF_TARGETED, type ReportReason } from "./safety";

/** A member the signed-in member blocked. `member` is null once that profile is no longer visible. */
export type BlockedMember = { memberId: string; blockedAt: string; member: MemberSummary | null };

export class SafetyActionError extends Error {}

type BlockRow = { blocked_id: string; created_at: string; blocked: MemberRow | null };

const RECONNECT_TO_REPORT = "Reconnectez-vous sur cet appareil pour signaler cette conversation.";

const SAFETY_ERRORS: Record<string, string> = {
  P0002: "Ce membre est introuvable.",
  "42501": "Cette action n’est pas autorisée. Vérifiez votre connexion et l’état de votre compte.",
  [SELF_TARGETED]: "Vous ne pouvez pas vous signaler ni vous bloquer vous-même.",
  "23505": "Vous avez déjà signalé ce membre : l’équipe de modération examine votre signalement.",
  "54000": "Vous avez envoyé beaucoup de signalements aujourd’hui. Réessayez demain, ou écrivez-nous si c’est urgent.",
  "22023": "Vérifiez le motif et la description du signalement.",
  // A conversation report is signed with the device key, like any messaging call.
  LS401: RECONNECT_TO_REPORT,
  LS403: RECONNECT_TO_REPORT,
  LS428: RECONNECT_TO_REPORT,
};

type Client = SupabaseClient | null;

function connected(supabase: Client) {
  if (!supabase) throw new SafetyActionError("Cette action est indisponible pour le moment.");
  return supabase;
}

function checkedId(id: string) {
  // Identifiers end up in PostgREST filters; refuse anything else before the request.
  if (!isUuid(id)) throw new SafetyActionError("Ce membre est introuvable.");
  return id;
}

/** Supabase answers with an error object; getSafetyErrorMessage words it for members. */
function raise(error: unknown) {
  if (error) throw error;
}

/** Blocks the member; the database also ends every link between the two of them. */
async function blockMember(supabase: Client, memberId: string) {
  const { error } = await connected(supabase).rpc("block_member", { p_member_id: checkedId(memberId) });
  raise(error);
}

/** Row security limits the delete to the signed-in member's own block. */
async function unblockMember(supabase: Client, memberId: string) {
  const { error } = await connected(supabase).from("member_blocks").delete().eq("blocked_id", checkedId(memberId));
  raise(error);
}

async function hasBlocked(supabase: Client, memberId: string) {
  const { data, error } = await connected(supabase).from("member_blocks").select("blocked_id").eq("blocked_id", checkedId(memberId));
  raise(error);
  return (data ?? []).length > 0;
}

async function loadBlockedMembers(supabase: Client): Promise<BlockedMember[]> {
  const { data, error } = await connected(supabase).from("member_blocks")
    .select(`blocked_id, created_at, blocked:profiles!member_blocks_blocked_id_fkey(${memberColumns})`)
    .order("created_at", { ascending: false });
  raise(error);
  return ((data ?? []) as unknown as BlockRow[]).map((row) => ({
    memberId: row.blocked_id, blockedAt: row.created_at, member: mapMemberSummary(row.blocked),
  }));
}

async function reportMember(supabase: Client, memberId: string, reason: ReportReason, details: string) {
  const id = checkedId(memberId);
  const problem = reportProblem(reason, details);
  if (problem) throw new SafetyActionError(problem);
  const { error } = await connected(supabase).rpc("report_member", { p_member_id: id, p_reason: reason, p_details: details.trim() });
  raise(error);
}

export function getSafetyErrorMessage(error: unknown): string {
  if (error instanceof SafetyActionError || error instanceof DeviceAccessError) return error.message;
  return SAFETY_ERRORS[errorCode(error)] ?? "L’action n’a pas abouti. Réessayez dans un instant.";
}

export function createSafetyRepository(supabase: Client) {
  return {
    blockMember: (memberId: string) => blockMember(supabase, memberId),
    unblockMember: (memberId: string) => unblockMember(supabase, memberId),
    hasBlocked: (memberId: string) => hasBlocked(supabase, memberId),
    loadBlockedMembers: () => loadBlockedMembers(supabase),
    reportMember: (memberId: string, reason: ReportReason, details: string) => reportMember(supabase, memberId, reason, details),
    getSafetyErrorMessage,
  };
}
