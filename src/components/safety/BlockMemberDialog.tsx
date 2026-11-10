import { useState } from "react";
import { Link } from "react-router-dom";
import { blockMember, getSafetyErrorMessage } from "../../lib/safetyRepository";
import { CHARTER_PATH } from "../../lib/site";
import { Button } from "../ui/Button";
import { FormStatus, type FormStatusValue } from "../ui/FormStatus";
import { ModalDialog } from "../ui/ModalDialog";

type BlockMemberDialogProps = { open: boolean; memberId: string; firstName: string; onClose: () => void; onBlocked: () => void };

/** Says what a block does before it happens: blocking also ends the pair's links. */
export function BlockMemberDialog({ open, memberId, firstName, onClose, onBlocked }: BlockMemberDialogProps) {
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });

  const confirm = async () => {
    setStatus({ kind: "loading", message: "Blocage en cours…" });
    try {
      await blockMember(memberId);
      setStatus({ kind: "idle" });
      onBlocked();
    } catch (error) {
      setStatus({ kind: "error", message: getSafetyErrorMessage(error) });
    }
  };

  return (
    <ModalDialog open={open} onClose={onClose} titleId="block-member-title">
      <h2 id="block-member-title">Bloquer {firstName}&nbsp;?</h2>
      <p>
        Vous ne pourrez plus vous écrire ni vous envoyer de demande, dans un sens comme dans l’autre.
        Votre connexion et un éventuel mentorat entre vous prendront fin.
      </p>
      <p>Personne n’est prévenu. Vous pourrez lever ce blocage à tout moment depuis «&nbsp;Mes relations&nbsp;».</p>
      <p className="safety-hint">
        Ce membre ne respecte pas la <Link to={CHARTER_PATH}>charte de conduite</Link>&nbsp;? Signalez-le aussi&nbsp;:
        l’équipe de modération pourra agir.
      </p>
      <FormStatus status={status} />
      <div className="modal-dialog__actions">
        <Button variant="outline" onClick={onClose} disabled={status.kind === "loading"}>Annuler</Button>
        <Button onClick={() => void confirm()} disabled={status.kind === "loading"}>Bloquer {firstName}</Button>
      </div>
    </ModalDialog>
  );
}
