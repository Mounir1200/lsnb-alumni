import { Ban, Flag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSafetyErrorMessage, hasBlocked, unblockMember } from "../../lib/safetyRepository";
import { FormStatus, type FormStatusValue } from "../ui/FormStatus";
import { BlockMemberDialog } from "./BlockMemberDialog";
import { ReportMemberDialog } from "./ReportMemberDialog";
import "./Safety.css";

type MemberSafetyProps = {
  memberId: string;
  firstName: string;
  /** In a conversation, a report also hands its latest messages to the moderators. */
  conversationId?: string;
  onBlockedChange: (blocked: boolean) => void;
};

/** Reporting and blocking a member, kept apart from the profile and messaging pages' own logic. */
export function MemberSafety({ memberId, firstName, conversationId, onBlockedChange }: MemberSafetyProps) {
  const [blocked, setBlocked] = useState(false);
  const [dialog, setDialog] = useState<"report" | "block" | null>(null);
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });
  const notify = useRef(onBlockedChange);
  notify.current = onBlockedChange;

  useEffect(() => {
    let active = true;
    // On a failed check the profile simply offers "Bloquer"; blocking twice is harmless.
    hasBlocked(memberId).then((value) => {
      if (!active) return;
      setBlocked(value);
      notify.current(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [memberId]);

  const changeBlocked = (value: boolean, message: string) => {
    setBlocked(value);
    setStatus({ kind: "success", message });
    notify.current(value);
  };

  const unblock = async () => {
    setStatus({ kind: "loading", message: "Levée du blocage…" });
    try {
      await unblockMember(memberId);
      changeBlocked(false, "Le blocage est levé. Vous pourrez de nouveau échanger après une demande acceptée.");
    } catch (error) {
      setStatus({ kind: "error", message: getSafetyErrorMessage(error) });
    }
  };

  return (
    <div className="member-safety">
      {blocked && <p className="member-safety__notice"><Ban aria-hidden="true" /> Vous avez bloqué {firstName}. Aucun de vous deux ne peut écrire à l’autre.</p>}
      <div className="member-safety__actions">
        <button type="button" onClick={() => setDialog("report")}><Flag aria-hidden="true" /> Signaler</button>
        {blocked
          ? <button type="button" onClick={() => void unblock()} disabled={status.kind === "loading"}>Débloquer</button>
          : <button type="button" onClick={() => setDialog("block")}><Ban aria-hidden="true" /> Bloquer</button>}
      </div>
      <FormStatus status={status} />
      <ReportMemberDialog open={dialog === "report"} memberId={memberId} firstName={firstName} conversationId={conversationId} onClose={() => setDialog(null)} />
      <BlockMemberDialog
        open={dialog === "block"}
        memberId={memberId}
        firstName={firstName}
        onClose={() => setDialog(null)}
        onBlocked={() => {
          setDialog(null);
          changeBlocked(true, `Blocage enregistré. Vos liens avec ${firstName} ont pris fin.`);
        }}
      />
    </div>
  );
}
