import { ArrowUpRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import type { Offer } from "../../lib/offerRepository";
import { Avatar } from "../ui/Avatar";
import { isOfferHidden, OfferDeadline, OfferKindTag } from "./OfferTags";

type OfferCardProps = {
  offer: Offer;
  isOwn: boolean;
};

export function OfferCard({ offer, isOwn }: OfferCardProps) {
  const author = offer.author;
  const authorName = author ? `${author.firstName} ${author.lastName}` : undefined;

  return (
    <article className={`offer-card offer-card--${offer.kind}`}>
      <div className="offer-card__meta">
        <OfferKindTag kind={offer.kind} />
        <OfferDeadline offer={offer} />
      </div>

      <h3>
        {/* The title link stretches over the card; the rest stays readable text. */}
        <Link className="offer-card__link" to={`/offres/${offer.id}`}>{offer.title}</Link>
      </h3>
      <p className="offer-card__organization">{offer.organization}</p>
      {offer.location && (
        <p className="offer-card__location"><MapPin size={14} aria-hidden="true" /> {offer.location}</p>
      )}
      <p className="offer-card__excerpt">{offer.description}</p>

      {(isOwn || offer.isDemo) && (
        <ul className="offer-card__flags" aria-label="Statut de l’offre">
          {offer.isDemo && <li>Offre fictive</li>}
          {isOwn && <li>Votre offre</li>}
          {isOwn && isOfferHidden(offer) && <li className="is-muted">Masquée</li>}
        </ul>
      )}

      <div className="offer-card__footer">
        {author ? (
          <span className="offer-card__author">
            <Avatar initials={author.initials} avatarTone={author.avatarTone} photoUrl={author.photoUrl} loading="lazy"
              label={`${offer.isDemo ? "Portrait fictif" : "Photo"} de ${authorName}`} />
            <span>Partagée par <b>{authorName}</b></span>
          </span>
        ) : (
          <span className="offer-card__author">Auteur indisponible</span>
        )}
        <ArrowUpRight size={19} className="offer-card__arrow" aria-hidden="true" />
      </div>
    </article>
  );
}
