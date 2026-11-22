import { LoaderCircle, LogIn, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { signOutAndLeave } from "../../auth/signOut";
import {
  ACCOUNT_DELETED_PATH, AccountDeletionBlocked, DELETE_ACCOUNT_SECTION_ID, DELETION_CONFIRMATION, DELETION_SIGN_IN_PATH,
  deleteAccount, deletionStatus, isDeletionConfirmed, type DeletionStatus,
} from "../../lib/accountDeletion";
import { clearProfileDrafts } from "../../lib/profileDraft";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui/Button";
import { FormStatus, type FormStatusValue } from "../ui/FormStatus";
import { ModalDialog } from "../ui/ModalDialog";
import "./DeleteAccount.css";

/** Where the dialog stands: asking the database, then erasing or saying why not. */
type Step = DeletionStatus | "checking" | "unavailable";
type Notice = Exclude<Step, "ready">;

const TITLE = <h2 id="delete-account-title">Supprimer définitivement votre compte&nbsp;?</h2>;

const NOTICES: Record<Notice, ReactNode> = {
  checking: <p role="status"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Vérification de votre connexion…</p>,
  sign_in_again: (
    <p>
      Pour protéger votre compte, sa suppression demande une connexion de moins de dix minutes.
      Reconnectez-vous&nbsp;: vous reviendrez ici pour confirmer.
    </p>
  ),
  last_super_admin: (
    <p>
      Vous êtes le seul super administrateur du hub. Nommez-en un autre depuis le hub avant de
      supprimer votre compte&nbsp;: quelqu’un doit garder les clés.
    </p>
  ),
  unavailable: <p role="alert">Impossible de vérifier votre compte pour l’instant. Rien n’a été supprimé.</p>,
};

type Actions = { isBusy: boolean; close: () => void; signInAgain: () => void; retry: () => void };

/** One way forward per notice: signing in again, trying again, or closing. */
function NoticeActions({ step, isBusy, close, signInAgain, retry }: Actions & { step: Notice }) {
  if (step === "last_super_admin") return <Button type="button" onClick={close}>Fermer</Button>;
  return (
    <>
      <Button type="button" variant="outline" onClick={close} disabled={isBusy}>Annuler</Button>
      {step === "sign_in_again" && (
        <Button type="button" onClick={signInAgain} disabled={isBusy}>
          <LogIn size={18} aria-hidden="true" /> {isBusy ? "Déconnexion…" : "Me reconnecter"}
        </Button>
      )}
      {step === "unavailable" && <Button type="button" onClick={retry}>Réessayer</Button>}
    </>
  );
}

type ConfirmProps = { typed: string; onType: (value: string) => void; status: FormStatusValue; close: () => void; onSubmit: () => void };

/** What goes, what stays, and the typed word that confirms. */
function ConfirmDeletion({ typed, onType, status, close, onSubmit }: ConfirmProps) {
  const isBusy = status.kind === "loading";
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSubmit(); };
  return (
    <form className="delete-account-dialog" onSubmit={submit}>
      {TITLE}
      <p>
        <b>Effacés tout de suite&nbsp;:</b> votre profil, vos relations et vos demandes, vos messages,
        vos offres et vos portraits Highlight. Votre photo suit dans les minutes qui viennent.
      </p>
      <p>
        <b>Conservés&nbsp;:</b> les signalements que vous avez faits, sans votre nom, et les décisions
        de modération qui vous concernent, dans le journal de l’équipe.
      </p>
      <label className="field-group">
        <span>Pour confirmer, tapez {DELETION_CONFIRMATION}</span>
        <input value={typed} onChange={(event) => onType(event.target.value)} autoComplete="off"
          autoCapitalize="characters" spellCheck={false} disabled={isBusy} />
      </label>
      <FormStatus status={status} />
      <div className="modal-dialog__actions">
        <Button type="button" variant="outline" onClick={close} disabled={isBusy}>Annuler</Button>
        <Button type="submit" className="delete-account__confirm" disabled={!isDeletionConfirmed(typed) || isBusy}>
          <Trash2 size={18} aria-hidden="true" /> {isBusy ? "Suppression…" : "Supprimer mon compte"}
        </Button>
      </div>
    </form>
  );
}

function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("checking");
  const [check, setCheck] = useState(0);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<FormStatusValue>({ kind: "idle" });
  const isBusy = status.kind === "loading";

  // The database says first whether the account can go now: nobody types the word for nothing.
  useEffect(() => {
    if (!open || !supabase) return;
    let active = true;
    setStep("checking");
    deletionStatus(supabase).then((next) => { if (active) setStep(next); }, () => { if (active) setStep("unavailable"); });
    return () => { active = false; };
  }, [open, check]);

  const close = () => {
    if (isBusy) return;
    setTyped("");
    setStatus({ kind: "idle" });
    onClose();
  };

  const signInAgain = async () => {
    if (!supabase || isBusy) return;
    setStatus({ kind: "loading", message: "Déconnexion…" });
    const left = await signOutAndLeave(supabase.auth, clearProfileDrafts, () => navigate(DELETION_SIGN_IN_PATH, { replace: true }));
    if (!left) setStatus({ kind: "error", message: "La déconnexion a échoué. Vérifiez votre connexion, puis réessayez." });
  };

  const erase = async () => {
    if (!supabase || !isDeletionConfirmed(typed) || isBusy) return;
    setStatus({ kind: "loading", message: "Suppression en cours…" });
    try {
      await deleteAccount(supabase, { clearDrafts: clearProfileDrafts, leave: () => navigate(ACCOUNT_DELETED_PATH, { replace: true }) });
    } catch (error) {
      if (error instanceof AccountDeletionBlocked) {
        setStatus({ kind: "idle" });
        setStep(error.reason);
        return;
      }
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "La suppression n’a pas abouti. Réessayez." });
    }
  };

  return (
    <ModalDialog open={open} onClose={close} titleId="delete-account-title">
      {step === "ready" ? (
        <ConfirmDeletion typed={typed} onType={setTyped} status={status} close={close} onSubmit={() => void erase()} />
      ) : (
        <div className="delete-account-dialog">
          {TITLE}
          {NOTICES[step]}
          <FormStatus status={status} />
          <div className="modal-dialog__actions">
            <NoticeActions step={step} isBusy={isBusy} close={close} signInAgain={() => void signInAgain()}
              retry={() => setCheck((value) => value + 1)} />
          </div>
        </div>
      )}
    </ModalDialog>
  );
}

/**
 * The last section of the profile editor: erasing the account, after a typed
 * confirmation. An alumnus who only wants to leave the public directory is
 * pointed to that option first.
 */
export function DeleteAccountSection({ isListedOption }: { isListedOption: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <section className="delete-account" id={DELETE_ACCOUNT_SECTION_ID} aria-labelledby="delete-account-heading">
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
      <DeleteAccountDialog open={isOpen} onClose={() => setIsOpen(false)} />
    </section>
  );
}
