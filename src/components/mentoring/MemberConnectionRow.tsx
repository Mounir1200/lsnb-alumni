import { MessageCircle } from "lucide-react";
import type { Ref } from "react";
import type { MemberConnection } from "../../lib/mentorshipRepository";
import { Button, ButtonLink } from "../ui/Button";
import { MentorshipPerson } from "./MentorshipPerson";

type MemberConnectionRowProps = {
  connection: MemberConnection;
  busy: boolean;
  confirming: boolean;
  toggleRef: Ref<HTMLButtonElement>;
  onToggle: () => void;
  onRemove: () => void;
  onKeep: () => void;
};

/** One connection in "Mes relations": write to the member, or remove the connection after confirming. */
export function MemberConnectionRow({ connection, busy, confirming, toggleRef, onToggle, onRemove, onKeep }: MemberConnectionRowProps) {
  const member = connection.peer;
  const name = member ? ` avec ${member.firstName} ${member.lastName}` : " avec ce profil indisponible";
  const confirmId = `remove-connection-${connection.id}`;
  return (
    <li className="mentorship-row">
      {member ? <MentorshipPerson member={member} /> : <p className="mentorship-row__unavailable">Profil indisponible</p>}
      <div className="mentorship-row__details">
        <time dateTime={connection.createdAt}>En relation depuis le {new Date(connection.createdAt).toLocaleDateString("fr-FR")}</time>
        <div className="mentorship-row__actions">
          <ButtonLink size="sm" variant="outline" to={`/espace/messages/${connection.requestId}`}>
            <MessageCircle size={15} aria-hidden="true" /> Écrire
          </ButtonLink>
          <button ref={toggleRef} type="button" className="button button--ghost button--sm" disabled={busy}
            aria-expanded={confirming} aria-controls={confirmId} aria-label={`Retirer la relation${name}`} onClick={onToggle}>
            Retirer
          </button>
        </div>
      </div>
      <div className="connection-confirm" id={confirmId} hidden={!confirming}>
        <p>Retirer cette relation ? Elle disparaît pour vous deux ; vos messages restent dans la messagerie.</p>
        <div className="connection-card__actions">
          <Button size="sm" disabled={busy} onClick={onRemove}>Confirmer le retrait</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onKeep}>Garder la relation</Button>
        </div>
      </div>
    </li>
  );
}
