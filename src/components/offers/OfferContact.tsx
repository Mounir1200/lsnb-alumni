import { Check, LoaderCircle, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MemberSummary } from "../../lib/memberSummary";
import {
  createConnectionRequest,
  getConnectionErrorMessage,
  loadProfileConnections,
  type ConnectionRequest,
} from "../../lib/mentorshipRepository";
import type { Offer } from "../../lib/offerRepository";
import { Button, ButtonLink } from "../ui/Button";

type SendStatus = { kind: "idle" | "loading" | "success" | "error"; message?: string };

function ContactIntro({ author }: { author: MemberSummary }) {
  return (
    <>
      <h2 id="offer-contact-title">Une question sur cette offre&nbsp;?</h2>
      <p>{author.firstName} peut vous éclairer sur les conditions, le calendrier ou la candidature.</p>
    </>
  );
}

function DemoOfferContact({ author }: { author: MemberSummary }) {
  const [isSent, setIsSent] = useState(false);
  return (
    <section className="offer-contact" aria-labelledby="offer-contact-title">
      <ContactIntro author={author} />
      <Button onClick={() => setIsSent(true)} disabled={isSent}>
        {isSent ? <Check size={18} aria-hidden="true" /> : <MessageCircle size={18} aria-hidden="true" />}
        {isSent ? "Question enregistrée" : `Poser une question à ${author.firstName}`}
      </Button>
      {isSent && <p role="status" className="offer-contact__note">Mode démonstration : aucun message réel n’a été envoyé.</p>}
    </section>
  );
}

// An offer question is a contact request: one open request per member pair (database rule).
function findOpenContact(requests: ConnectionRequest[], userId: string) {
  return requests.find((request) => request.kind === "contact" && request.requesterId === userId && request.status !== "declined");
}

function MemberOfferContact({ offer, author, userId }: { offer: Offer; author: MemberSummary; userId: string }) {
  const [reload, setReload] = useState(0);
  const [requests, setRequests] = useState<ConnectionRequest[]>();
  const [loadError, setLoadError] = useState<string>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [status, setStatus] = useState<SendStatus>({ kind: "idle" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setRequests(undefined);
    setLoadError(undefined);
    loadProfileConnections(userId, author.id)
      .then((result) => { if (active) setRequests(result); })
      .catch((error: unknown) => { if (active) setLoadError(getConnectionErrorMessage(error)); });
    return () => { active = false; };
  }, [userId, author.id, reload]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status.kind === "loading") return;
    const message = String(new FormData(event.currentTarget).get("message") ?? "");
    setStatus({ kind: "loading" });
    try {
      await createConnectionRequest(userId, author.id, "contact", message, offer.id);
      if (!mounted.current) return;
      setIsFormOpen(false);
      setStatus({ kind: "success", message: `Votre question a été transmise à ${author.firstName}. Suivez sa réponse dans Mes relations et demandes.` });
      setReload((value) => value + 1);
    } catch (error) {
      if (mounted.current) setStatus({ kind: "error", message: getConnectionErrorMessage(error) });
    }
  };

  const openContact = requests && findOpenContact(requests, userId);

  const renderAction = () => {
    if (loadError) {
      return (
        <div className="form-status form-status--error" role="alert">
          {loadError}
          <Button size="sm" variant="light" onClick={() => setReload((value) => value + 1)}>Réessayer</Button>
        </div>
      );
    }
    if (!requests) {
      return <p className="offer-contact__note" role="status"><LoaderCircle size={16} className="spin" aria-hidden="true" /> Vérification de vos échanges…</p>;
    }
    if (openContact?.status === "accepted") {
      return (
        <>
          <p className="offer-contact__note">{author.firstName} a déjà accepté un échange avec vous. Poursuivez la discussion dans votre conversation privée.</p>
          <ButtonLink to={`/espace/messages/${openContact.id}`} variant="outline">Ouvrir la conversation</ButtonLink>
        </>
      );
    }
    if (openContact) {
      return (
        <>
          <p className="offer-contact__note">
            {openContact.offerId === offer.id
              ? `Votre question sur cette offre attend la réponse de ${author.firstName}.`
              : `Une demande d’échange avec ${author.firstName} est déjà en attente. Elle couvre aussi vos questions sur cette offre.`}
          </p>
          <ButtonLink to="/espace/relations" variant="outline">Mes relations et demandes</ButtonLink>
        </>
      );
    }
    if (isFormOpen) {
      return (
        <form className="offer-contact__form" onSubmit={handleSubmit}>
          <label className="field-group">
            <span>Votre question</span>
            <textarea
              name="message"
              rows={5}
              minLength={20}
              maxLength={1200}
              required
              // The form opens from the button the member just pressed.
              autoFocus
              disabled={status.kind === "loading"}
              placeholder="Présentez-vous en une phrase, puis posez une question précise sur l’offre."
            />
            <small>20 à 1 200 caractères. Visible uniquement par vous et {author.firstName}, avec le lien vers cette offre.</small>
            <small>Ce texte de présentation n’est pas chiffré comme les messages. Partagez vos informations confidentielles dans la messagerie après acceptation.</small>
          </label>
          <div className="offer-contact__actions">
            <Button variant="outline" disabled={status.kind === "loading"} onClick={() => setIsFormOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={status.kind === "loading"}>
              {status.kind === "loading" && <LoaderCircle size={17} className="spin" aria-hidden="true" />} Envoyer ma question
            </Button>
          </div>
        </form>
      );
    }
    return (
      <Button onClick={() => { setStatus({ kind: "idle" }); setIsFormOpen(true); }}>
        <MessageCircle size={18} aria-hidden="true" /> Poser une question à {author.firstName}
      </Button>
    );
  };

  return (
    <section className="offer-contact" aria-labelledby="offer-contact-title">
      <ContactIntro author={author} />
      {renderAction()}
      {status.message && (
        <div className={`form-status form-status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
          {status.message}
        </div>
      )}
    </section>
  );
}

export function OfferContact({ offer, userId }: { offer: Offer; userId?: string }) {
  const author = offer.author;
  if (!author) {
    return (
      <section className="offer-contact">
        <p className="offer-contact__note">Le profil de la personne qui a partagé cette offre n’est plus disponible.</p>
      </section>
    );
  }
  if (offer.isDemo) return <DemoOfferContact author={author} />;
  if (!userId) return null;
  return <MemberOfferContact offer={offer} author={author} userId={userId} />;
}
