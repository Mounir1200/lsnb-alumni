import { CircleCheck } from "lucide-react";
import { ButtonLink } from "../components/ui/Button";

/** Where an erased account lands: the end of the journey says what happened, without a sign-in form. */
export function AccountDeletedPage() {
  return (
    <section className="auth-state-page">
      <CircleCheck aria-hidden="true" />
      <h1>Votre compte a été supprimé.</h1>
      <p>
        Votre profil, votre photo, vos relations, vos messages et vos offres ont été effacés.
        Merci d’avoir fait vivre le réseau&nbsp;: vous pourrez y revenir quand vous voudrez.
      </p>
      <ButtonLink to="/">Revenir à l’accueil</ButtonLink>
    </section>
  );
}
