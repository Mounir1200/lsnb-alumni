import type { ConnectionKind, ConnectionRequest } from "./mentorshipData";

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
