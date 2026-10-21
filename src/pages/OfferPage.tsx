import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, Building2, MapPin } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { MentorshipPerson } from "../components/mentoring/MentorshipPerson";
import { OfferContact } from "../components/offers/OfferContact";
import { OfferOwnerPanel } from "../components/offers/OfferOwnerPanel";
import { OfferAccessState, OfferNotice, OffersLoadError } from "../components/offers/OfferStates";
import { formatOfferDate, OfferDeadline, OfferKindTag } from "../components/offers/OfferTags";
import { ButtonLink } from "../components/ui/Button";
import { useOfferAccess } from "../hooks/useOfferAccess";
import { useOffer } from "../hooks/useOffers";
import "../components/offers/Offers.css";

export function OfferPage() {
  const { offerId = "" } = useParams();
  const access = useOfferAccess();
  const { user } = useAuth();
  const offerState = useOffer(access, offerId);

  if (access !== "member" && access !== "demo") return <OfferAccessState access={access} next={`/offres/${offerId}`} />;

  if (offerState.status === "loading") {
    return (
      <section className="simple-page page-shell" aria-live="polite">
        <p className="eyebrow eyebrow--dark">Chargement</p>
        <h1>Nous ouvrons cette offre.</h1>
      </section>
    );
  }

  if (offerState.status === "error") {
    return (
      <div className="offer-page page-shell">
        <OffersLoadError title="Cette offre n’a pas pu être chargée." onRetry={offerState.retry} />
      </div>
    );
  }

  const offer = offerState.offer;
  if (!offer) {
    return (
      <section className="auth-state-page">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>Cette offre n’est plus disponible.</h1>
        <p>Son auteur l’a peut-être retirée, ou elle n’est plus visible dans le réseau.</p>
        <ButtonLink to="/offres">Voir les offres ouvertes</ButtonLink>
      </section>
    );
  }

  const isOwn = !offer.isDemo && offer.authorId === user?.id;

  return (
    <div className="offer-page">
      <div className="page-shell">
        <Link to="/offres" className="back-link">
          <ArrowLeft size={17} aria-hidden="true" /> Retour aux offres
        </Link>
        <OfferNotice />

        <section className={`offer-hero offer-hero--${offer.kind}`} aria-labelledby="offer-title">
          <div className="offer-hero__tags">
            <OfferKindTag kind={offer.kind} />
            <OfferDeadline offer={offer} />
            {offer.isDemo && <span className="offer-hero__demo">Offre fictive · démonstration</span>}
          </div>
          <h1 id="offer-title">{offer.title}</h1>
          <p><Building2 size={17} aria-hidden="true" /> {offer.organization}</p>
          {offer.location && <p><MapPin size={17} aria-hidden="true" /> {offer.location}</p>}
        </section>

        <div className="offer-layout">
          <article className="offer-body">
            <p className="eyebrow eyebrow--dark">Ce que propose l’offre</p>
            <div className="offer-body__description">{offer.description}</div>
            {offer.linkUrl && (
              <a className="button button--outline button--md offer-body__link" href={offer.linkUrl} target="_blank" rel="noopener noreferrer">
                Voir l’annonce officielle <ArrowUpRight size={17} aria-hidden="true" />
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
            )}
            <p className="offer-body__published">
              Publiée le {formatOfferDate(offer.createdAt)}. Vérifiez toujours les conditions auprès de l’organisme avant de candidater.
            </p>
          </article>

          <aside className="offer-aside">
            {offer.author && (
              <section className="offer-author" aria-label="Personne qui partage l’offre">
                <p>Partagée par</p>
                <MentorshipPerson member={offer.author} />
              </section>
            )}
            {isOwn ? <OfferOwnerPanel offer={offer} /> : <OfferContact key={offer.id} offer={offer} userId={user?.id} />}
          </aside>
        </div>
      </div>
    </div>
  );
}
