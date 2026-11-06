import { LogIn, UserPlus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ButtonLink } from "../ui/Button";

type ProfileGateProps = {
  profileId: string;
  name?: string;
  heading: "h1" | "h2";
  headingId?: string;
};

/** Profiles are for members: visitors are asked to sign in, or to create their account. */
export function ProfileGate({ profileId, name, heading: Heading, headingId }: ProfileGateProps) {
  const next = encodeURIComponent(`/alumni/${profileId}`);
  return (
    <div className="profile-gate">
      <Heading id={headingId}>{name ? `Le profil de ${name} est réservé aux membres.` : "Ce profil est réservé aux membres."}</Heading>
      <p>
        Connectez-vous pour consulter son parcours et lui proposer une connexion ou un mentorat.
        Pas encore de compte ? Rejoignez l’annuaire en quelques minutes.
      </p>
      <div className="profile-gate__actions">
        <ButtonLink to={`/connexion?next=${next}`}><LogIn size={18} aria-hidden="true" /> Se connecter</ButtonLink>
        <ButtonLink to="/rejoindre" variant="outline"><UserPlus size={18} aria-hidden="true" /> Créer mon compte</ButtonLink>
      </div>
    </div>
  );
}

export type GatedProfile = { id: string; name: string };

/** Opens over the directory when a visitor picks a profile; Escape, the backdrop or the button closes it. */
export function ProfileGateDialog({ profile, onClose }: { profile: GatedProfile | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (profile && !dialog.open) dialog.showModal();
    if (!profile && dialog.open) dialog.close();
  }, [profile]);

  return (
    <dialog
      ref={dialogRef}
      className="profile-gate-dialog"
      aria-labelledby="profile-gate-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
    >
      {profile && (
        <div className="profile-gate-dialog__panel">
          <button type="button" className="profile-gate-dialog__close" aria-label="Fermer" onClick={() => dialogRef.current?.close()}>
            <X size={20} aria-hidden="true" />
          </button>
          <ProfileGate profileId={profile.id} name={profile.name} heading="h2" headingId="profile-gate-title" />
        </div>
      )}
    </dialog>
  );
}
