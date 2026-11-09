import { Ban } from "lucide-react";
import { useEffect, useState } from "react";
import { getSafetyErrorMessage, loadBlockedMembers, unblockMember, type BlockedMember } from "../../lib/safetyRepository";
import { MentorshipPerson } from "../mentoring/MentorshipPerson";
import { Button } from "../ui/Button";
import { FormStatus, type FormStatusValue } from "../ui/FormStatus";

function BlockedMemberRow({ item, busy, onUnblock }: { item: BlockedMember; busy: boolean; onUnblock: () => void }) {
  const name = item.member ? `${item.member.firstName} ${item.member.lastName}` : "ce profil indisponible";
  return (
    <li className="mentorship-row">
      {item.member ? <MentorshipPerson member={item.member} /> : <p className="mentorship-row__unavailable">Profil indisponible</p>}
      <div className="mentorship-row__details">
        <time dateTime={item.blockedAt}>Blocage depuis le {new Date(item.blockedAt).toLocaleDateString("fr-FR")}</time>
        <div className="mentorship-row__actions">
          <Button size="sm" variant="outline" disabled={busy} aria-label={`Débloquer ${name}`} onClick={onUnblock}>Débloquer</Button>
        </div>
      </div>
    </li>
  );
}

/** "Mes relations" lists the members you blocked, so that each block can be lifted. Hidden while there is none. */
export function BlockedMembersSection() {
  const [blocked, setBlocked] = useState<BlockedMember[]>([]);
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    loadBlockedMembers()
      .then((list) => { if (active) setBlocked(list); })
      .catch((error) => { if (active) setStatus({ kind: "error", message: getSafetyErrorMessage(error) }); });
    return () => { active = false; };
  }, [reload]);

  const unblock = async (memberId: string) => {
    setBusyId(memberId);
    try {
      await unblockMember(memberId);
      setBlocked((list) => list.filter((item) => item.memberId !== memberId));
      setStatus({ kind: "success", message: "Le blocage est levé. Vous pourrez de nouveau échanger après une demande acceptée." });
    } catch (error) {
      setStatus({ kind: "error", message: getSafetyErrorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  if (!blocked.length && status.kind === "idle") return null;
  return (
    <section className="connections-section" aria-labelledby="blocked-members-title">
      <div className="connections-section__heading">
        <h2 id="blocked-members-title"><Ban size={20} aria-hidden="true" /> Membres bloqués</h2>
        <span className="connections-count">{blocked.length}</span>
      </div>
      <p className="connections-empty">Ces membres ne peuvent ni vous écrire ni vous envoyer de demande, et vous non plus. Ils n’en sont pas prévenus.</p>
      <FormStatus status={status} />
      {status.kind === "error" && (
        <Button size="sm" variant="outline" onClick={() => { setStatus({ kind: "idle" }); setReload((value) => value + 1); }}>Réessayer</Button>
      )}
      {blocked.length > 0 && (
        <ul className="connections-list">
          {blocked.map((item) => (
            <BlockedMemberRow key={item.memberId} item={item} busy={busyId === item.memberId} onUnblock={() => void unblock(item.memberId)} />
          ))}
        </ul>
      )}
    </section>
  );
}
