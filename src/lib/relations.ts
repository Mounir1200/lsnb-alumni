import type { ConnectionKind, ConnectionRequest } from "./mentorshipData";

/** The two requests a member sends from a profile. */
export type RequestKind = Extract<ConnectionKind, "connection" | "mentoring">;

/**
 * A mentoring request also asks to connect; a connection request asks for
 * nothing else. The database applies the same rule to real requests.
 */
export function requestedKinds(kind: RequestKind): RequestKind[] {
  return kind === "mentoring" ? ["connection", "mentoring"] : ["connection"];
}

/** Where two members stand in their peer connection, seen by one of them. */
export type PeerConnectionStatus = "connected" | "sent" | "received" | "none";

export function peerConnectionStatus(userId: string, requests: ConnectionRequest[], isConnected: boolean): PeerConnectionStatus {
  if (isConnected) return "connected";
  const pending = requests.find((request) => request.kind === "connection" && request.status === "pending");
  if (!pending) return "none";
  return pending.requesterId === userId ? "sent" : "received";
}

const requestKindLabels: Record<ConnectionKind, string> = {
  connection: "Demande de connexion",
  mentoring: "Demande de mentorat",
  contact: "Demande d’échange",
};

export function requestKindLabel({ kind, offerId }: Pick<ConnectionRequest, "kind" | "offerId">) {
  return offerId ? "Question sur une offre" : requestKindLabels[kind];
}
