import { Orbit, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { clearProfileDraft, hasSameDraftContent, saveProfileDraft, type EditorForm } from "../../lib/profileDraft";
import { Button } from "../ui/Button";

const draftDateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

/** Keeps every unsaved change on this device; returns whether the form differs from the saved profile. */
export function useProfileDraftAutosave(userId: string | undefined, form: EditorForm | undefined, savedForm: EditorForm | undefined) {
  const hasUnsavedChanges = Boolean(form && savedForm && !hasSameDraftContent(form, savedForm));
  useEffect(() => {
    if (!userId || !form || !savedForm) return;
    if (hasUnsavedChanges) saveProfileDraft(userId, form);
    else clearProfileDraft(userId);
  }, [userId, form, savedForm, hasUnsavedChanges]);
  return hasUnsavedChanges;
}

export function DraftResumeNotice({ savedAt, onDiscard }: { savedAt: Date; onDiscard: () => void }) {
  return (
    <div className="form-status form-status--warning profile-draft-notice" role="status">
      <span>
        Brouillon repris : vos modifications du {draftDateFormat.format(savedAt)} ne sont pas
        encore enregistrées dans l’annuaire.
      </span>
      <Button size="sm" variant="outline" onClick={onDiscard}>
        <Undo2 size={16} aria-hidden="true" /> Revenir au profil enregistré
      </Button>
    </div>
  );
}

export function DraftHint() {
  return (
    <p className="profile-draft-hint">
      Vos modifications sont gardées en brouillon sur cet appareil jusqu’à leur enregistrement.
      La photo, elle, doit être choisie à nouveau.
    </p>
  );
}

/** Alumni choose whether visitors see their card; students are never listed publicly. */
export function PublicListingField({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="form-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <Orbit aria-hidden="true" />
      <span>
        <b>Apparaître dans l’annuaire public</b>
        Sans connexion, les visiteurs voient votre nom, votre photo, votre promotion, votre domaine,
        votre ville et votre pays. Votre fiche complète reste réservée aux membres connectés.
      </span>
    </label>
  );
}
