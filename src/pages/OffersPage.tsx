import { PencilLine, Plus, RotateCcw, Search } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { OfferCard } from "../components/offers/OfferCard";
import {
  OfferAccessState,
  OfferNotice,
  OffersEmpty,
  OffersLoadError,
  OffersLoading,
  OffersNoResults,
} from "../components/offers/OfferStates";
import { isOfferHidden, offerKindPluralLabels } from "../components/offers/OfferTags";
import { Button, ButtonLink } from "../components/ui/Button";
import { useOfferAccess } from "../hooks/useOfferAccess";
import { useOffers } from "../hooks/useOffers";
import { isOfferExpired, OFFER_KINDS, todayIsoDate, type Offer, type PublisherStatus } from "../lib/offerRepository";
import { normalizeSearchText } from "../lib/searchText";
import "../components/offers/Offers.css";

const noOffers: Offer[] = [];
const FILTER_KEYS = ["type", "q", "mes"];

function describeOfferCount(count: number, ownOnly: boolean) {
  const plural = count > 1 ? "s" : "";
  return ownOnly ? `offre${plural} publiée${plural}` : `offre${plural} ouverte${plural}`;
}

function PublishPanel({ publisher, isDemo }: { publisher: PublisherStatus | null; isDemo: boolean }) {
  if (publisher === "publisher") {
    return (
      <div className="offers-hero__panel">
        <p className="offers-hero__panel-title">Vous repérez une opportunité&nbsp;?</p>
        <p>Signalez-la aux élèves et aux alumni. Leurs questions arriveront dans vos relations et demandes.</p>
        <ButtonLink to="/offres/publier" variant="light"><Plus size={17} aria-hidden="true" /> Publier une offre</ButtonLink>
      </div>
    );
  }
  if (publisher === "mentoring-off") {
    return (
      <div className="offers-hero__panel">
        <p className="offers-hero__panel-title">Publier en tant que mentor</p>
        <p>Activez « Je propose du mentorat » dans votre profil pour partager des offres avec le réseau.</p>
        <ButtonLink to="/espace/modifier" variant="light"><PencilLine size={17} aria-hidden="true" /> Modifier mon profil</ButtonLink>
      </div>
    );
  }
  return (
    <ol className="offers-hero__steps" aria-label="Comment utiliser les offres">
      <li><b>Les mentors partagent</b>Stages, bourses et admissions qu’ils connaissent de près.</li>
      <li><b>Vous comparez</b>Type, lieu et date limite sont visibles d’un coup d’œil.</li>
      <li><b>Vous posez vos questions</b>{isDemo ? "En démonstration, aucun message n’est envoyé." : "Directement à la personne qui partage l’offre."}</li>
    </ol>
  );
}

export function OffersPage() {
  const access = useOfferAccess();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const offersState = useOffers(access);
  const userId = user?.id;
  const offers = offersState.status === "ready" ? offersState.offers : noOffers;
  const publisher = offersState.status === "ready" ? offersState.publisher : null;
  const kind = OFFER_KINDS.find((item) => item === searchParams.get("type"));
  const query = searchParams.get("q") ?? "";
  const ownOnly = searchParams.get("mes") === "true" && Boolean(userId);

  // Public listing: open offers. "Mes offres": every own offer, expired or hidden included.
  const listedOffers = useMemo(() => {
    const today = todayIsoDate();
    return offers.filter((offer) => (ownOnly
      ? offer.authorId === userId
      : !isOfferExpired(offer, today) && !(offer.authorId === userId && isOfferHidden(offer))));
  }, [offers, ownOnly, userId]);

  const matchingOffers = useMemo(() => {
    const needle = normalizeSearchText(query.trim());
    if (!needle) return listedOffers;
    return listedOffers.filter((offer) => normalizeSearchText([
      offer.title, offer.organization, offer.location, offer.description,
      offer.author ? `${offer.author.firstName} ${offer.author.lastName}` : "",
    ].join(" ")).includes(needle));
  }, [listedOffers, query]);

  if (access !== "member" && access !== "demo") return <OfferAccessState access={access} next="/offres" />;

  const filteredOffers = kind ? matchingOffers.filter((offer) => offer.kind === kind) : matchingOffers;
  const canPublish = publisher === "publisher";
  const hasOwnOffers = offers.some((offer) => offer.authorId === userId);
  const hasFilters = Boolean(kind || query || ownOnly);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    const next = new URLSearchParams(searchParams);
    FILTER_KEYS.forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  const renderResults = () => {
    if (offersState.status === "loading") return <OffersLoading />;
    if (offersState.status === "error") return <OffersLoadError onRetry={offersState.retry} />;
    if (listedOffers.length === 0) return <OffersEmpty canPublish={canPublish} ownOnly={ownOnly} />;
    if (filteredOffers.length === 0) return <OffersNoResults onReset={resetFilters} />;
    return (
      <div className="offers-grid">
        {filteredOffers.map((offer) => <OfferCard key={offer.id} offer={offer} isOwn={offer.authorId === userId} />)}
      </div>
    );
  };

  return (
    <div className="offers-page">
      <header className="offers-hero">
        <div className="page-shell offers-hero__inner">
          <div className="offers-hero__copy">
            <p className="eyebrow">Offres du réseau</p>
            <h1>Des portes ouvertes par ceux qui sont passés avant vous.</h1>
            <p>
              Stages, bourses et admissions universitaires repérés par les mentors alumni du LSNB.
              Lisez l’offre, puis posez vos questions à la personne qui la partage.
            </p>
          </div>
          <PublishPanel publisher={publisher} isDemo={access === "demo"} />
        </div>
      </header>

      <section className="page-shell offers-content" aria-label="Offres publiées">
        <OfferNotice />

        <div className="offers-toolbar">
          <div className="offers-kind-filter" role="group" aria-label="Type d’offre">
            <button type="button" aria-pressed={!kind} onClick={() => updateFilter("type", "")}>
              Toutes <span>{matchingOffers.length}</span>
            </button>
            {OFFER_KINDS.map((item) => (
              <button key={item} type="button" aria-pressed={kind === item} onClick={() => updateFilter("type", item)}>
                {offerKindPluralLabels[item]} <span>{matchingOffers.filter((offer) => offer.kind === item).length}</span>
              </button>
            ))}
          </div>

          <label className="offers-search">
            <span className="sr-only">Rechercher une offre</span>
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Domaine, organisme, pays…"
              onChange={(event) => updateFilter("q", event.target.value)}
            />
          </label>

          {(canPublish || hasOwnOffers) && (
            <label className="directory-filter-switch offers-own-switch">
              <input type="checkbox" checked={ownOnly} onChange={(event) => updateFilter("mes", event.target.checked ? "true" : "")} />
              <span className="directory-filter-switch__track" aria-hidden="true"><i /></span>
              <span><b>Mes offres</b>Y compris clôturées</span>
            </label>
          )}
        </div>

        <div className="offers-summary">
          <p role="status" aria-live="polite">
            {offersState.status === "ready" && (
              <><b>{filteredOffers.length}</b> {describeOfferCount(filteredOffers.length, ownOnly)}</>
            )}
            {offersState.status === "loading" && "Chargement des offres…"}
          </p>
          {access === "demo" && <span>Offres fictives · démonstration</span>}
          {hasFilters && offersState.status === "ready" && (
            <Button variant="outline" size="sm" onClick={resetFilters}><RotateCcw size={15} aria-hidden="true" /> Réinitialiser</Button>
          )}
        </div>

        {renderResults()}

        {access === "member" && (
          <p className="offers-footnote">
            Les offres restent visibles tant que leur auteur propose du mentorat. Vos questions et leurs réponses
            se retrouvent dans <Link className="text-link text-link--dark" to="/espace/relations">Mes relations et demandes</Link>.
          </p>
        )}
      </section>
    </div>
  );
}
