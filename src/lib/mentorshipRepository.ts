import { supabase } from "./supabase";
import { createMentorshipRepository } from "./mentorshipData";

export type { ConnectionKind, ConnectionStatus, MemberSummary, ConnectionRequest, Mentorship, MentorshipNetwork, MemberConnection } from "./mentorshipData";

export const {
  loadConnectionRequests,
  loadProfileConnections,
  countPendingReceivedRequests,
  loadMentorshipNetwork,
  loadActiveMentorships,
  createConnectionRequest,
  answerConnectionRequest,
  withdrawConnectionRequest,
  endMentorship,
  loadMemberConnections,
  findMemberConnection,
  removeMemberConnection,
  getConnectionErrorMessage
} = createMentorshipRepository(supabase);
