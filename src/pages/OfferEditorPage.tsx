import { ArrowLeft, BriefcaseBusiness, CalendarClock, Eye, LoaderCircle, MessageCircle, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { OfferNoticeState } from "../components/offers/OfferStates";
import { offerKindLabels } from "../components/offers/OfferTags";
import { Button, ButtonLink } from "../components/ui/Button";
import {
  createOffer,
  getOfferErrorMessage,
  loadOffer,
  loadPublisherStatus,
  OFFER_KINDS,
  OFFER_TEXT_LIMITS,
  toOfferDraft,
  todayIsoDate,
  updateOffer,
  type Offer,
  type OfferDraft,
  type OfferKind,
  type PublisherStatus,
} from "../lib/offerRepository";
import "../components/offers/Offers.css";

type EditorState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-publisher"; publisher: PublisherStatus }
  | { status: "not-found" }
  | { status: "ready"; offer?: Offer };

const emptyDraft: OfferDraft = {
  kind: "internship", title: "", organization: "", location: "", description: "", linkUrl: "", deadline: "",
};

const kindDescriptions: Record<OfferKind, string> = {
  internship: "En entreprise, laboratoire ou association",
  scholarship: "Financement d’études ou de recherche",
  admission: "Inscription universitaire ou concours",
};

function OfferForm({ offer, userId }: { offer?: Offer; userId: string }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OfferDraft>(offer ? toOfferDraft(offer) : emptyDraft);
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const today = todayIsoDate();
  // An unchanged past deadline must stay submittable when editing an expired offer.
  const minDeadline = offer?.deadline && offer.deadline < today ? offer.deadline : today;

  const updateField = <Key extends keyof OfferDraft>(key: Key, value: OfferDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError(undefined);
    try {
      let savedId: string;
      if (offer) {
        await updateOffer(offer, draft);
        savedId = offer.id;
      } else {
        savedId = await createOffer(userId, draft);
      }
      const offerNotice = offer ? "Les modifications de l’offre sont enregistrées." : "Votre offre est publiée.";
      // Replace the form entry so that going back does not reopen a submitted form.
      navigate(`/offres/${savedId}`, { replace: true, state: { offerNotice } satisfies OfferNoticeState });
    } catch (saveError) {
      setError(getOfferErrorMessage(saveError));
      setIsSaving(false);
    }
  };

  return (
    <form className="account-form" onSubmit={handleSubmit}>
      <fieldset className="role-picker offer-kind-picker" disabled={isSaving}>
        <legend>Type d’offre</legend>
        {OFFER_KINDS.map((kind) => (
          <label key={kind} className={draft.kind === kind ? "is-selected" : ""}>
            <input type="radio" name="kind" value={kind} checked={draft.kind === kind} onChange={() => updateField("kind", kind)} />
            <b>{offerKindLabels[kind]}</b>
            <span>{kindDescriptions[kind]}</span>
          </label>
        ))}
      </fieldset>

      <label className="field-group">
        <span>Intitulé</span>
        <input
          value={draft.title}
          onChange={(event) => updateField("title", event.target.value)}
          minLength={OFFER_TEXT_LIMITS.title.min}
          maxLength={OFFER_TEXT_LIMITS.title.max}
          placeholder="Ex. Stage en analyse de données de santé"
          disabled={isSaving}
          required
        />
      </label>

      <div className="form-row">
        <label className="field-group">
          <span>Organisme</span>
          <input
            value={draft.organization}
            onChange={(event) => updateField("organization", event.target.value)}
            minLength={OFFER_TEXT_LIMITS.organization.min}
            maxLength={OFFER_TEXT_LIMITS.organization.max}
            placeholder="Entreprise, université, fondation…"
            disabled={isSaving}
            required
          />
        </label>
        <label className="field-group">
          <span>Lieu</span>
          <input
            value={draft.location}
            onChange={(event) => updateField("location", event.target.value)}
            maxLength={OFFER_TEXT_LIMITS.location.max}
            placeholder="Ville, pays ou « À distance »"
            disabled={isSaving}
          />
          <small>Facultatif.</small>
        </label>
      </div>

      <div className="form-row">
        <label className="field-group">
          <span>Date limite de candidature</span>
          <input
            type="date"
            value={draft.deadline}
            min={minDeadline}
            onChange={(event) => updateField("deadline", event.target.value)}
            disabled={isSaving}
          />
          <small>Facultative. Après cette date, l’offre quitte la liste des offres ouvertes.</small>
        </label>
        <label className="field-group">
          <span>Lien vers l’annonce</span>
          <input
            type="url"
            inputMode="url"
            value={draft.linkUrl}
            onChange={(event) => updateField("linkUrl", event.target.value)}
            placeholder="https://"
            disabled={isSaving}
          />
          <small>Facultatif. Adresse HTTPS publique.</small>
        </label>
      </div>

      <label className="field-group">
        <span>Description</span>
        <textarea
          rows={8}
          value={draft.description}
          onChange={(event) => updateField("description", event.target.value)}
          minLength={OFFER_TEXT_LIMITS.description.min}
          maxLength={OFFER_TEXT_LIMITS.description.max}
          placeholder="Ce qui est proposé, le profil recherché, la durée, le financement, les étapes de candidature…"
          disabled={isSaving}
          required
        />
        <small>30 à 3 000 caractères. N’y indiquez pas de coordonnées privées : les questions passent par le site.</small>
      </label>

      {error && <div className="form-status form-status--error" role="alert">{error}</div>}

      <div className="profile-editor-actions">
        <ButtonLink to={offer ? `/offres/${offer.id}` : "/offres"} size="lg" variant="outline">Annuler</ButtonLink>
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          {isSaving ? "Enregistrement…" : offer ? "Enregistrer l’offre" : "Publier l’offre"}
        </Button>
      </div>
    </form>
  );
}

function NotPublisherState({ publisher }: { publisher: PublisherStatus }) {
  const isAlumni = publisher === "mentoring-off";
  return (
    <section className="auth-state-page">
      <BriefcaseBusiness aria-hidden="true" />
      <h1>{isAlumni ? "Publiez des offres en tant que mentor." : "La publication est réservée aux mentors alumni."}</h1>
      <p>
        {isAlumni
          ? "Activez « Je propose du mentorat » dans votre profil : vos offres restent visibles tant que cette option est active."
          : "Vous pouvez consulter les offres du réseau et poser vos questions aux mentors qui les partagent."}
      </p>
      {isAlumni
        ? <ButtonLink to="/espace/modifier">Modifier mon profil</ButtonLink>
        : <ButtonLink to="/offres">Voir les offres</ButtonLink>}
    </section>
  );
}

export function OfferEditorPage() {
  const { offerId } = useParams();
  const { user } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState<EditorState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setState({ status: "loading" });
    const load = async (): Promise<EditorState> => {
      if (offerId !== undefined) {
        const offer = await loadOffer(offerId);
        return offer?.authorId === userId ? { status: "ready", offer } : { status: "not-found" };
      }
      const publisher = await loadPublisherStatus(userId);
      return publisher === "publisher" ? { status: "ready" } : { status: "not-publisher", publisher };
    };
    load()
      .then((next) => { if (active) setState(next); })
      .catch((error: unknown) => { if (active) setState({ status: "error", message: getOfferErrorMessage(error) }); });
    return () => { active = false; };
  }, [offerId, userId, reloadKey]);

  if (!userId) return null;

  if (state.status === "loading") {
    return (
      <div className="auth-state-page" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>{offerId ? "Chargement de l’offre…" : "Vérification de votre profil de mentor…"}</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="auth-state-page">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>Le formulaire ne s’est pas ouvert.</h1>
        <p role="alert">{state.message}</p>
        <Button onClick={() => setReloadKey((value) => value + 1)}>Réessayer</Button>
      </div>
    );
  }
  if (state.status === "not-publisher") return <NotPublisherState publisher={state.publisher} />;
  if (state.status === "not-found") {
    return (
      <section className="auth-state-page">
        <BriefcaseBusiness aria-hidden="true" />
        <h1>Cette offre ne peut pas être modifiée.</h1>
        <p>Elle a été supprimée, ou elle a été publiée par un autre membre.</p>
        <ButtonLink to="/offres">Voir les offres</ButtonLink>
      </section>
    );
  }

  const offer = state.offer;
  return (
    <div className="account-page offer-editor-page">
      <div className="page-shell account-page__grid">
        <aside className="account-story">
          <Link to={offer ? `/offres/${offer.id}` : "/offres"} className="back-link">
            <ArrowLeft size={17} aria-hidden="true" /> {offer ? "Retour à l’offre" : "Retour aux offres"}
          </Link>
          <p className="eyebrow eyebrow--dark">{offer ? "Modifier une offre" : "Nouvelle offre"}</p>
          <h1>Partagez une porte que vous connaissez.</h1>
          <p>Une offre utile dit clairement ce qui est proposé, pour qui, et avant quelle date.</p>
          <div className="account-story__principles">
            <span><Eye aria-hidden="true" /><b>Visible par les membres connectés</b>Tant que vous proposez du mentorat.</span>
            <span><MessageCircle aria-hidden="true" /><b>Questions privées</b>Elles arrivent dans Mes relations et demandes.</span>
            <span><CalendarClock aria-hidden="true" /><b>Clôture automatique</b>Après la date limite, l’offre quitte la liste.</span>
          </div>
        </aside>

        <section className="account-form-wrap" aria-labelledby="offer-form-title">
          <div className="account-form-wrap__header">
            <p id="offer-form-title">{offer ? "Modifier l’offre" : "Publier une offre"}</p>
            <span>Visible par les membres</span>
          </div>
          <OfferForm key={offer?.id ?? "new"} offer={offer} userId={userId} />
        </section>
      </div>
    </div>
  );
}
