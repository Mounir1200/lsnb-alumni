import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ACCOUNT_DELETED_PATH, DELETION_CONFIRMATION, deleteAccount, isDeletionConfirmed } from "../../lib/accountDeletion";
import { clearProfileDrafts } from "../../lib/profileDraft";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui/Button";
import { FormStatus, type FormStatusValue } from "../ui/FormStatus";
import { ModalDialog } from "../ui/ModalDialog";
import "./DeleteAccount.css";

function DeleteAccountDialog({ open, userId, onClose }: { open: boolean; userId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });
  const isBusy = status.kind === "loading";

  const close = () => {
    if (isBusy) return;
    setTyped("");
    setStatus({ kind: "idle" });
    onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !isDeletionConfirmed(typed) || isBusy) return;
    setStatus({ kind: "loading", message: "Suppression en cours…" });
    try {
      await deleteAccount(supabase, userId, {
        clearDrafts: clearProfileDrafts,
        leave: () => navigate(ACCOUNT_DELETED_PATH, { replace: true }),
      });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "La suppression n’a pas abouti. Réessayez." });
    }
  };

  return (
    <ModalDialog open={open} onClose={close} titleId="delete-account-title">
      <form className="delete-account-dialog" onSubmit={(event) => void submit(event)}>
        <h2 id="delete-account-title">Supprimer définitivement votre compte&nbsp;?</h2>
        <p>
          <b>Effacés tout de suite&nbsp;:</b> votre profil et votre photo, vos relations et vos demandes,
          vos messages, vos offres et vos portraits Highlight.
        </p>
        <p>
          <b>Conservés&nbsp;:</b> les signalements que vous avez faits, sans votre nom, et les décisions
          de modération qui vous concernent, dans le journal de l’équipe.
        </p>
        <label className="field-group">
          <span>Pour confirmer, tapez {DELETION_CONFIRMATION}</span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={isBusy}
          />
        </label>
        <FormStatus status={status} />
        <div className="modal-dialog__actions">
          <Button type="button" variant="outline" onClick={close} disabled={isBusy}>Annuler</Button>
          <Button type="submit" className="delete-account__confirm" disabled={!isDeletionConfirmed(typed) || isBusy}>
            <Trash2 size={18} aria-hidden="true" /> {isBusy ? "Suppression…" : "Supprimer mon compte"}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * The last section of the profile editor: erasing the account, after a typed
 * confirmation. An alumnus who only wants to leave the public directory is
 * pointed to that option first.
 */
export function DeleteAccountSection({ userId, isListedOption }: { userId: string; isListedOption: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <section className="delete-account" aria-labelledby="delete-account-heading">
      <div>
        <h2 id="delete-account-heading">Supprimer mon compte</h2>
        <p>
          Votre compte et tout ce qui s’y rattache sont effacés aussitôt, sans retour possible.
          {isListedOption && " Pour seulement quitter l’annuaire public, décochez plutôt l’option plus haut."}
        </p>
      </div>
      <Button type="button" variant="outline" className="delete-account__open" onClick={() => setIsOpen(true)}>
        <Trash2 size={18} aria-hidden="true" /> Supprimer mon compte…
      </Button>
      <DeleteAccountDialog open={isOpen} userId={userId} onClose={() => setIsOpen(false)} />
    </section>
  );
}
