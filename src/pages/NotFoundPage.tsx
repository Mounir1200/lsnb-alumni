import { ButtonLink } from "../components/ui/Button";
import { RouteStop } from "../components/visual/RouteStop";

export function NotFoundPage() {
  return (
    <section className="simple-page page-shell">
      <RouteStop>Erreur 404</RouteStop>
      <h1>Cette trajectoire ne mène nulle part.</h1>
      <p>La page demandée n’existe pas ou a changé d’adresse.</p>
      <ButtonLink to="/">Revenir à l’accueil</ButtonLink>
    </section>
  );
}
