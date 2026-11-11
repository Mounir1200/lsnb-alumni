import { LogIn, PencilLine, UserPlus, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { getProfileCompletionPath } from "../../lib/auth";
import { EDIT_PROFILE_PATH, JOIN_PATH } from "../../lib/invitations";
import { profileGateKind, type ProfileGateKind } from "../../lib/memberStatus";
import { ButtonLink } from "../ui/Button";
import { APPROVAL_EXPLANATION } from "./PendingApproval";

type ProfileGateProps = {
  profileId: string;
  name?: string;
  heading: "h1" | "h2";
  headingId?: string;
};

type Gate = { title: string; text: string; actions: ReactNode };

const gates: Record<ProfileGateKind, (subject: string, profilePath: string) => Gate> = {
  join: (subject, profilePath) => ({
    title: `${subject} est réservé aux membres.`,
    text: "Connectez-vous pour consulter son parcours et lui proposer une connexion ou un mentorat. Pas encore de compte ? Rejoignez l’annuaire en quelques minutes.",
    actions: (
      <>
        <ButtonLink to={`/connexion?next=${encodeURIComponent(profilePath)}`}><LogIn size={18} aria-hidden="true" /> Se connecter</ButtonLink>
        <ButtonLink to={JOIN_PATH} variant="outline"><UserPlus size={18} aria-hidden="true" /> Créer mon compte</ButtonLink>
      </>
    ),
  }),
  complete: (subject, profilePath) => ({
    title: `${subject} s’ouvrira quand votre profil sera complet.`,
    text: "Terminez votre profil : le modérateur de votre promotion le validera, puis les parcours du réseau vous seront ouverts.",
    actions: <ButtonLink to={getProfileCompletionPath(profilePath)}><PencilLine size={18} aria-hidden="true" /> Compléter mon profil</ButtonLink>,
  }),
  wait: (subject) => ({
    title: `${subject} s’ouvrira dès que votre compte sera validé.`,
    text: `${APPROVAL_EXPLANATION} En attendant, une photo et un parcours renseigné l’aident à vous reconnaître.`,
    actions: <ButtonLink to={EDIT_PROFILE_PATH}><PencilLine size={18} aria-hidden="true" /> Modifier mon profil</ButtonLink>,
  }),
};

/** Profiles are for active members: a visitor is asked to sign in or join, a signed-in account learns what it still needs. */
export function ProfileGate({ profileId, name, heading: Heading, headingId }: ProfileGateProps) {
  const { user, memberStatus } = useAuth();
  const kind = profileGateKind({ isSignedIn: Boolean(user), status: memberStatus });
  const gate = gates[kind](name ? `Le profil de ${name}` : "Ce profil", `/alumni/${profileId}`);
  return (
    <div className="profile-gate">
      <Heading id={headingId}>{gate.title}</Heading>
      <p>{gate.text}</p>
      <div className="profile-gate__actions">{gate.actions}</div>
    </div>
  );
}

export type GatedProfile = { id: string; name: string };

/** Opens over the directory when a reader who is not an active member picks a profile; Escape, the backdrop or the button closes it. */
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
