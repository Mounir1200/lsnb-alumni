import { CloudOff, RefreshCw, Search, UsersRound } from "lucide-react";
import { Button, ButtonLink } from "../ui/Button";

const SKELETON_CARD_COUNT = 6;

// The results toolbar announces loading; these placeholders are visual only.
export function DirectoryLoading({ listView }: { listView: boolean }) {
  return (
    <div className={listView ? "directory-grid directory-grid--list" : "directory-grid"} aria-hidden="true">
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <div key={index} className="directory-skeleton">
          <span className="directory-skeleton__media" />
          <span className="directory-skeleton__line directory-skeleton__line--short" />
          <span className="directory-skeleton__line directory-skeleton__line--title" />
          <span className="directory-skeleton__line" />
        </div>
      ))}
    </div>
  );
}

export function DirectoryLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="directory-empty directory-empty--error" role="alert">
      <CloudOff size={34} aria-hidden="true" />
      <h2>L’annuaire n’a pas pu être chargé.</h2>
      <p>Vérifiez votre connexion, puis réessayez.</p>
      <Button onClick={onRetry}>
        <RefreshCw size={16} aria-hidden="true" /> Réessayer
      </Button>
    </div>
  );
}

export function DirectoryEmpty() {
  return (
    <div className="directory-empty">
      <UsersRound size={34} aria-hidden="true" />
      <h2>L’annuaire est encore vide.</h2>
      <p>Les profils apparaîtront ici dès que des membres auront complété leur inscription.</p>
      <ButtonLink to="/espace/modifier" variant="outline">
        Compléter mon profil
      </ButtonLink>
    </div>
  );
}

export function DirectoryNoResults({ onReset }: { onReset: () => void }) {
  return (
    <div className="directory-empty">
      <Search size={34} aria-hidden="true" />
      <h2>Aucun parcours ne correspond encore.</h2>
      <p>Essayez une spécialité plus large ou retirez un filtre.</p>
      <Button variant="outline" onClick={onReset}>
        Voir tous les profils
      </Button>
    </div>
  );
}
