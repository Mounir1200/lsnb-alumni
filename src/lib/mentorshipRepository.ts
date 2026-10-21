import { supabase } from "./supabase";
import { createMentorshipRepository } from "./mentorshipData";

export type { ConnectionKind, ConnectionStatus, MemberSummary, ConnectionRequest, Mentorship, MentorshipNetwork } from "./mentorshipData";

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
  getConnectionErrorMessage
} = createMentorshipRepository(supabase);
