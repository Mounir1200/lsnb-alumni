import { Check, LoaderCircle, Orbit, UserCheck, UserPlus } from "lucide-react";
import type { PeerConnectionStatus } from "../../lib/relations";
import { Button, ButtonLink } from "../ui/Button";

export type RequestKind = "connection" | "mentoring";
export type MentoringStatus = "active" | "pending" | "none";

const connectionLabels: Record<Exclude<PeerConnectionStatus, "received">, string> = {
  connected: "Vous êtes en relation",
  sent: "Demande de connexion envoyée",
  none: "Se connecter",
};

const mentoringLabels: Record<MentoringStatus, string> = {
  active: "Mentorat en cours",
  pending: "Demande de mentorat en attente",
  none: "Demander un mentorat",
};

type ProfileRequestButtonsProps = {
  checking: boolean;
  peerStatus: PeerConnectionStatus;
  /** Absent when the member does not offer mentoring. */
  mentoring?: MentoringStatus;
  onRequest: (kind: RequestKind) => void;
};

/** Any two members can connect; mentoring is asked separately from members who offer it. */
export function ProfileRequestButtons({ checking, peerStatus, mentoring, onRequest }: ProfileRequestButtonsProps) {
  if (checking) {
    return (
      <Button size="lg" disabled>
        <LoaderCircle size={18} className="spin" aria-hidden="true" /> Vérification des demandes…
      </Button>
    );
  }
  return (
    <div className="profile-hero__buttons">
      {peerStatus === "received" ? (
        <ButtonLink to="/espace/relations" size="lg">
          <UserCheck size={18} aria-hidden="true" /> Répondre à sa demande de connexion
        </ButtonLink>
      ) : (
        <Button size="lg" disabled={peerStatus !== "none"} onClick={() => onRequest("connection")}>
          {peerStatus === "none" ? <UserPlus size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
          {connectionLabels[peerStatus]}
        </Button>
      )}
      {mentoring && (
        <Button size="lg" variant="ghost" disabled={mentoring !== "none"} onClick={() => onRequest("mentoring")}>
          {mentoring === "none" ? <Orbit size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
          {mentoringLabels[mentoring]}
        </Button>
      )}
    </div>
  );
}
