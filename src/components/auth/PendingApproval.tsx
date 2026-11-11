import { Hourglass, PencilLine } from "lucide-react";
import { EDIT_PROFILE_PATH } from "../../lib/invitations";
import { ButtonLink } from "../ui/Button";
import "./PendingApproval.css";

export const APPROVAL_EXPLANATION =
  "Le modérateur de votre promotion, ou un administrateur, vérifie que vous faites bien partie du lycée.";

/** Takes the place of a members-only page while the account waits for approval. */
export function PendingApproval() {
  return (
    <section className="auth-state-page">
      <Hourglass aria-hidden="true" />
      <h1>Votre compte attend sa validation.</h1>
      <p>
        {APPROVAL_EXPLANATION} En attendant, votre profil n’est visible par personne et vous ne
        pouvez pas encore écrire aux membres.
      </p>
      <ButtonLink to={EDIT_PROFILE_PATH}>
        <PencilLine size={18} aria-hidden="true" /> Modifier mon profil
      </ButtonLink>
    </section>
  );
}

/** Tells a waiting member, on their own profile, why nobody else sees it yet. */
export function PendingApprovalNotice() {
  return (
    <div className="pending-approval-notice" role="status">
      <Hourglass size={20} aria-hidden="true" />
      <p>
        <b>Votre compte attend sa validation.</b> {APPROVAL_EXPLANATION} D’ici là, personne d’autre
        ne voit ce profil. Une photo et un parcours renseigné l’aident à vous reconnaître.
      </p>
    </div>
  );
}
