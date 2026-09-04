import { ButtonLink } from "../components/ui/Button";

export function NotFoundPage() {
  return (
    <section className="simple-page page-shell">
      <p className="eyebrow eyebrow--dark">Erreur 404</p>
      <h1>Cette trajectoire ne mène nulle part.</h1>
      <p>La page demandée n’existe pas ou a changé d’adresse.</p>
      <ButtonLink to="/">Revenir à l’accueil</ButtonLink>
    </section>
  );
}
