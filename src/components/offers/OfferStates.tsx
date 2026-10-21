import { BriefcaseBusiness, CloudOff, LoaderCircle, LockKeyhole, RefreshCw, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import type { OfferAccess } from "../../hooks/useOfferAccess";
import { getProfileCompletionPath } from "../../lib/auth";
import { Button, ButtonLink } from "../ui/Button";

const SKELETON_CARD_COUNT = 6;

export type OfferNoticeState = { offerNotice: string };

/** Confirmation carried by navigation state after publishing, editing or deleting. */
export function OfferNotice() {
  const notice = (useLocation().state as Partial<OfferNoticeState> | null)?.offerNotice;
  return notice ? <div className="form-status form-status--success offers-notice" role="status">{notice}</div> : null;
}

/** Every access state except "member" and "demo", which render the offers. */
export function OfferAccessState({ access, next }: { access: Exclude<OfferAccess, "member" | "demo">; next: string }) {
  const { refreshProfile } = useAuth();

  if (access === "checking") {
    return (
      <div className="auth-state-page" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Chargement des offres…</p>
      </div>
    );
  }
  if (access === "profile-error") {
    return (
      <div className="auth-state-page" role="alert">
        <p>Impossible de vérifier votre profil. Réessayez.</p>
        <Button onClick={() => void refreshProfile()}>Réessayer</Button>
      </div>
    );
  }
  if (access === "incomplete") {
    return (
      <section className="auth-state-page">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>Complétez votre profil pour voir les offres.</h1>
        <p>Les offres du réseau sont partagées entre membres dont le profil est complet.</p>
        <ButtonLink to={getProfileCompletionPath(next)}>Compléter mon profil</ButtonLink>
      </section>
    );
  }
  return (
    <section className="auth-state-page">
      <LockKeyhole aria-hidden="true" />
      <h1>Les offres sont réservées aux membres.</h1>
      <p>
        Stages, bourses et admissions sont partagés par les mentors alumni du LSNB.
        Connectez-vous pour les consulter et poser vos questions.
      </p>
      <div className="offers-state-actions">
        <ButtonLink to={`/connexion?next=${encodeURIComponent(next)}`}>Se connecter</ButtonLink>
        <ButtonLink to="/rejoindre" variant="outline">Rejoindre le réseau</ButtonLink>
      </div>
    </section>
  );
}

// The results summary announces loading; these placeholders are visual only.
export function OffersLoading() {
  return (
    <div className="offers-grid" aria-hidden="true">
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <div key={index} className="offer-skeleton">
          <span className="offer-skeleton__line offer-skeleton__line--short" />
          <span className="offer-skeleton__line offer-skeleton__line--title" />
          <span className="offer-skeleton__line" />
          <span className="offer-skeleton__line" />
        </div>
      ))}
    </div>
  );
}

export function OffersLoadError({ onRetry, title = "Les offres n’ont pas pu être chargées." }: { onRetry: () => void; title?: string }) {
  return (
    <div className="directory-empty directory-empty--error" role="alert">
      <CloudOff size={34} aria-hidden="true" />
      <h2>{title}</h2>
      <p>Vérifiez votre connexion, puis réessayez.</p>
      <Button onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Réessayer</Button>
    </div>
  );
}

export function OffersEmpty({ canPublish, ownOnly }: { canPublish: boolean; ownOnly: boolean }) {
  return (
    <div className="directory-empty">
      <BriefcaseBusiness size={34} aria-hidden="true" />
      <h2>{ownOnly ? "Vous n’avez publié aucune offre." : "Aucune offre ouverte pour le moment."}</h2>
      <p>
        {canPublish
          ? "Un stage, une bourse ou une admission à signaler ? Partagez-la avec les élèves et les alumni."
          : "Les mentors alumni publient ici les opportunités qu’ils repèrent. Revenez bientôt."}
      </p>
      {canPublish && <ButtonLink to="/offres/publier">Publier une offre</ButtonLink>}
    </div>
  );
}

export function OffersNoResults({ onReset }: { onReset: () => void }) {
  return (
    <div className="directory-empty">
      <Search size={34} aria-hidden="true" />
      <h2>Aucune offre ne correspond.</h2>
      <p>Essayez un autre mot-clé ou un autre type d’offre.</p>
      <Button variant="outline" onClick={onReset}>Voir toutes les offres</Button>
    </div>
  );
}
