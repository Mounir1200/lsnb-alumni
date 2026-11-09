import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { reportConversation } from "../../lib/messagingRepository";
import { REPORT_REASONS, REPORTED_MESSAGE_COUNT, reportProblem, type ReportReason } from "../../lib/safety";
import { getSafetyErrorMessage, reportMember } from "../../lib/safetyRepository";
import { CHARTER_PATH } from "../../lib/site";
import { Button } from "../ui/Button";
import { FormStatus, type FormStatusValue } from "../ui/FormStatus";
import { ModalDialog } from "../ui/ModalDialog";

type ReportMemberDialogProps = {
  open: boolean;
  memberId: string;
  firstName: string;
  conversationId?: string;
  /** What is reported, when it is more than the member: an offer, for instance. */
  heading?: string;
  initialDetails?: string;
  onClose: () => void;
};

function ReportScope({ conversationId }: { conversationId?: string }) {
  return conversationId ? (
    <p className="safety-hint">
      Les {REPORTED_MESSAGE_COUNT} derniers messages de cette conversation seront transmis à l’équipe pour qu’elle puisse juger.
      Pour signaler sans transmettre vos messages, faites-le depuis le profil du membre.
    </p>
  ) : null;
}

/** A report reaches the moderation team; the reported member never learns who sent it. */
export function ReportMemberDialog({ open, memberId, firstName, conversationId, heading, initialDetails = "", onClose }: ReportMemberDialogProps) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState(initialDetails);
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = reportProblem(reason, details);
    if (problem || !reason) return setStatus({ kind: "error", message: problem ?? "Choisissez un motif." });
    setStatus({ kind: "loading", message: "Envoi du signalement…" });
    try {
      await (conversationId ? reportConversation(conversationId, reason, details) : reportMember(memberId, reason, details));
      setReason("");
      setDetails("");
      setStatus({ kind: "success", message: "Merci. Votre signalement a été transmis à l’équipe de modération." });
    } catch (error) {
      setStatus({ kind: "error", message: getSafetyErrorMessage(error) });
    }
  };

  return (
    <ModalDialog open={open} onClose={onClose} titleId="report-member-title">
      <h2 id="report-member-title">{heading ?? `Signaler ${firstName}`}</h2>
      <p>Votre signalement va à l’équipe de modération. La personne signalée ne saura pas qu’il vient de vous.</p>
      <form className="report-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={status.kind === "loading"}>
          <legend>Que se passe-t-il&nbsp;?</legend>
          {REPORT_REASONS.map((item) => (
            <label key={item.value} className="report-form__reason">
              <input type="radio" name="reason" value={item.value} checked={reason === item.value}
                onChange={() => { setReason(item.value); setStatus({ kind: "idle" }); }} />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        {reason === "minor_safety" && (
          <p className="safety-hint safety-hint--urgent">
            Un élève est en danger&nbsp;? Prévenez aussi un adulte de confiance et, en cas d’urgence, la police (17 au Burkina Faso).
          </p>
        )}
        <label className="field-group">
          <span>Ce qui s’est passé {reason === "other" ? "(obligatoire)" : "(facultatif)"}</span>
          <textarea name="details" rows={3} maxLength={1000} value={details} disabled={status.kind === "loading"}
            onChange={(event) => setDetails(event.target.value)} placeholder="Dates, messages, ce qui vous a inquiété…" />
          <small>{[...details].length}/1 000</small>
        </label>
        <ReportScope conversationId={conversationId} />
        <FormStatus status={status} />
        <p className="report-form__charter">Les règles du réseau sont dans la <Link to={CHARTER_PATH} target="_blank" rel="noopener">charte de conduite<span className="sr-only"> (nouvel onglet)</span></Link>.</p>
        <div className="modal-dialog__actions">
          <Button variant="outline" onClick={onClose} disabled={status.kind === "loading"}>{status.kind === "success" ? "Fermer" : "Annuler"}</Button>
          {status.kind !== "success" && <Button type="submit" disabled={status.kind === "loading" || !reason}>Envoyer le signalement</Button>}
        </div>
      </form>
    </ModalDialog>
  );
}
