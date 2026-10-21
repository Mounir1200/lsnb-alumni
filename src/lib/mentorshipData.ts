import type { SupabaseClient } from "@supabase/supabase-js";
import { mapMemberSummary as mapMember, memberColumns, type MemberRow, type MemberSummary } from "./memberSummary";
import { collectRowsById as collectRows, isUuid } from "./pagedRows";

export type { MemberSummary };
export type ConnectionKind = "contact" | "mentoring";
export type ConnectionStatus = "pending" | "accepted" | "declined";

/** The offer a contact request asks about; `offer` is null once it is deleted or hidden. */
export type RequestedOffer = { id: string; title: string };

export type ConnectionRequest = {
  id: string;
  requesterId: string;
  recipientId: string;
  kind: ConnectionKind;
  status: ConnectionStatus;
  message: string;
  createdAt: string;
  respondedAt: string | null;
  requester: MemberSummary | null;
  recipient: MemberSummary | null;
  offerId: string | null;
  offer: RequestedOffer | null;
};

export type Mentorship = {
  id: string;
  mentorId: string;
  menteeId: string;
  createdAt: string;
  mentor: MemberSummary | null;
  mentee: MemberSummary | null;
};

export type MentorshipNetwork = { mentors: Mentorship[]; mentees: Mentorship[] };

type RequestRow = {
  id: string; requester_id: string; recipient_id: string; request_kind: ConnectionKind;
  status: ConnectionStatus; message: string; created_at: string; responded_at: string | null;
  requester: MemberRow | null; recipient: MemberRow | null;
  offer_id: string | null; offer: RequestedOffer | null;
};
type MentorshipRow = {
  id: string; mentor_id: string; mentee_id: string; created_at: string;
  mentor: MemberRow | null; mentee: MemberRow | null;
};

const requestColumns = `id, requester_id, recipient_id, request_kind, status, message, created_at, responded_at, offer_id,
  requester:profiles!connection_requests_requester_id_fkey(${memberColumns}),
  recipient:profiles!connection_requests_recipient_id_fkey(${memberColumns}),
  offer:offers!connection_requests_offer_id_fkey(id, title)`;

function mentorshipColumns(publicNetwork: boolean) {
  const join = publicNetwork ? "!inner" : "";
  return `id, mentor_id, mentee_id, created_at,
    mentor:profiles!mentorships_mentor_id_fkey${join}(${memberColumns}),
    mentee:profiles!mentorships_mentee_id_fkey${join}(${memberColumns})`;
}

class ConnectionActionError extends Error {}

export function createMentorshipRepository(supabase: SupabaseClient | null) {
  function client() {
    if (!supabase) throw new ConnectionActionError("Les mises en relation sont indisponibles pour le moment.");
    return supabase;
  }

  function checkedId(id: string) {
    // IDs are interpolated into PostgREST OR filters; reject filter syntax here.
    if (!isUuid(id)) throw new ConnectionActionError("Ce profil ou cette demande est introuvable.");
    return id;
  }

  function mapRequest(row: RequestRow): ConnectionRequest {
    return {
      id: row.id, requesterId: row.requester_id, recipientId: row.recipient_id,
      kind: row.request_kind, status: row.status, message: row.message,
      createdAt: row.created_at, respondedAt: row.responded_at,
      requester: mapMember(row.requester), recipient: mapMember(row.recipient),
      offerId: row.offer_id, offer: row.offer,
    };
  }

  function mapMentorship(row: MentorshipRow): Mentorship {
    return {
      id: row.id, mentorId: row.mentor_id, menteeId: row.mentee_id, createdAt: row.created_at,
      mentor: mapMember(row.mentor), mentee: mapMember(row.mentee),
    };
  }

  async function loadConnectionRequests(userId: string): Promise<ConnectionRequest[]> {
    const id = checkedId(userId);
    const db = client();
    const rows = await collectRows((before) => {
      const query = db.from("connection_requests").select(requestColumns)
        .or(`requester_id.eq.${id},recipient_id.eq.${id}`).order("id", { ascending: false }).limit(100);
      return before ? query.lt("id", before) : query;
    });
    return (rows as RequestRow[]).map(mapRequest);
  }

  async function loadProfileConnections(userId: string, profileId: string): Promise<ConnectionRequest[]> {
    const ownId = checkedId(userId);
    const otherId = checkedId(profileId);
    const db = client();
    const rows = await collectRows((before) => {
      const query = db.from("connection_requests").select(requestColumns)
        .or(`and(requester_id.eq.${ownId},recipient_id.eq.${otherId}),and(requester_id.eq.${otherId},recipient_id.eq.${ownId})`)
        .order("id", { ascending: false }).limit(100);
      return before ? query.lt("id", before) : query;
    });
    return (rows as RequestRow[]).map(mapRequest);
  }

  async function countPendingReceivedRequests(userId: string): Promise<number> {
    const { count, error } = await client().from("connection_requests")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", checkedId(userId)).eq("status", "pending");
    if (error) throw error;
    return count ?? 0;
  }

  async function readMentorships(profileId: string, publicNetwork: boolean): Promise<Mentorship[]> {
    const id = checkedId(profileId);
    const db = client();
    const rows = await collectRows((before) => {
      let query = db.from("mentorships").select(mentorshipColumns(publicNetwork))
        .or(`mentor_id.eq.${id},mentee_id.eq.${id}`).is("ended_at", null);
      if (publicNetwork) {
        query = query.eq("mentor.is_active", true).eq("mentor.profile_completed", true)
          .eq("mentee.is_active", true).eq("mentee.profile_completed", true);
      }
      query = query.order("id", { ascending: false }).limit(100);
      return before ? query.lt("id", before) : query;
    });
    return (rows as MentorshipRow[]).map(mapMentorship);
  }

  async function loadMentorshipNetwork(profileId: string): Promise<MentorshipNetwork> {
    const relations = await readMentorships(profileId, true);
    return {
      mentors: relations.filter((relation) => relation.menteeId === profileId),
      mentees: relations.filter((relation) => relation.mentorId === profileId),
    };
  }

  function loadActiveMentorships(userId: string): Promise<Mentorship[]> {
    return readMentorships(userId, false);
  }

  async function createConnectionRequest(
    userId: string, recipientId: string, kind: ConnectionKind, message: string, offerId?: string,
  ): Promise<void> {
    checkedId(userId);
    checkedId(recipientId);
    if (offerId !== undefined) checkedId(offerId);
    if (userId === recipientId) throw new ConnectionActionError("Vous ne pouvez pas vous envoyer une demande.");
    const content = message.trim();
    if ([...content].length < 20 || [...content].length > 1200) {
      throw new ConnectionActionError("Votre message doit contenir entre 20 et 1 200 caractères.");
    }
    const { error } = await client().from("connection_requests").insert({
      requester_id: userId, recipient_id: recipientId, request_kind: kind, message: content,
      ...(offerId ? { offer_id: offerId } : {}),
    });
    if (error) throw error;
  }

  async function answerConnectionRequest(requestId: string, status: "accepted" | "declined"): Promise<void> {
    const { data, error } = await client().from("connection_requests").update({ status })
      .eq("id", checkedId(requestId)).eq("status", "pending").select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ConnectionActionError("Cette demande a déjà été traitée ou n’est plus accessible. Actualisez la liste.");
  }

  async function withdrawConnectionRequest(requestId: string): Promise<void> {
    const { data, error } = await client().from("connection_requests").delete()
      .eq("id", checkedId(requestId)).eq("status", "pending").select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ConnectionActionError("Cette demande a déjà été traitée ou retirée. Actualisez la liste.");
  }

  async function endMentorship(id: string): Promise<void> {
    // The trigger supplies the authoritative time and actor; the client only
    // requests the transition. A stale/double action cannot report false success.
    const { data, error } = await client().from("mentorships").update({ ended_at: new Date().toISOString() })
      .eq("id", checkedId(id)).is("ended_at", null).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ConnectionActionError("Ce mentorat est déjà terminé ou n’est plus accessible. Actualisez la liste.");
  }

  function getConnectionErrorMessage(error: unknown): string {
    if (error instanceof ConnectionActionError) return error.message;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "23505") return "Une demande ou une relation existe déjà avec cette personne. Actualisez la liste.";
    if (code === "42501") return "Cette action n’est pas autorisée. Vérifiez votre connexion et votre profil.";
    if (code === "23514" || code === "22023" || code === "P0001") {
      return "Cette demande ne peut plus être traitée. Vérifiez le message et la disponibilité du membre, puis actualisez.";
    }
    return "Impossible de mettre à jour les mises en relation. Réessayez dans un instant.";
  }

  return { loadConnectionRequests, loadProfileConnections, countPendingReceivedRequests, loadMentorshipNetwork, loadActiveMentorships, createConnectionRequest, answerConnectionRequest, withdrawConnectionRequest, endMentorship, getConnectionErrorMessage };
}
