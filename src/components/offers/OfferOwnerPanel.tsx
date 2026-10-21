import { LoaderCircle, PencilLine, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteOffer, getOfferErrorMessage, isOfferExpired, type Offer } from "../../lib/offerRepository";
import { Button, ButtonLink } from "../ui/Button";
import type { OfferNoticeState } from "./OfferStates";
import { isOfferHidden } from "./OfferTags";

export function OfferOwnerPanel({ offer }: { offer: Offer }) {
  const navigate = useNavigate();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const deleteButton = useRef<HTMLButtonElement>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(undefined);
    try {
      await deleteOffer(offer.id);
      // Replace the entry: going back must not reopen a deleted offer.
      navigate("/offres?mes=true", { replace: true, state: { offerNotice: "L’offre a été supprimée." } satisfies OfferNoticeState });
    } catch (deleteError) {
      setError(getOfferErrorMessage(deleteError));
      setIsDeleting(false);
    }
  };

  return (
    <section className="offer-owner" aria-labelledby="offer-owner-title">
      <h2 id="offer-owner-title">Votre offre</h2>
      {isOfferHidden(offer) && (
        <p className="offer-owner__note">
          Masquée pour les autres membres : elle redevient visible quand « Je propose du mentorat » est activé
          dans <Link className="text-link text-link--dark" to="/espace/modifier">votre profil</Link>.
        </p>
      )}
      {isOfferExpired(offer) && (
        <p className="offer-owner__note">La date limite est passée : l’offre n’apparaît plus dans la liste des offres ouvertes.</p>
      )}
      <p>
        Les questions des membres arrivent dans{" "}
        <Link className="text-link text-link--dark" to="/espace/relations">Mes relations et demandes</Link>.
      </p>
      <div className="offer-owner__actions">
        <ButtonLink to={`/offres/${offer.id}/modifier`}><PencilLine size={17} aria-hidden="true" /> Modifier l’offre</ButtonLink>
        <button
          ref={deleteButton}
          type="button"
          className="button button--outline button--md"
          disabled={isDeleting}
          aria-expanded={isConfirming}
          aria-controls="offer-delete-confirm"
          onClick={() => setIsConfirming((value) => !value)}
        >
          <Trash2 size={17} aria-hidden="true" /> Supprimer
        </button>
      </div>
      <div className="connection-confirm" id="offer-delete-confirm" hidden={!isConfirming}>
        <p>Supprimer définitivement cette offre&nbsp;? Les questions déjà reçues restent dans vos relations, sans lien vers l’offre.</p>
        <div className="connection-card__actions">
          <Button size="sm" disabled={isDeleting} onClick={() => void handleDelete()}>
            {isDeleting && <LoaderCircle size={15} className="spin" aria-hidden="true" />} Confirmer la suppression
          </Button>
          <Button size="sm" variant="outline" disabled={isDeleting} onClick={() => { setIsConfirming(false); deleteButton.current?.focus(); }}>
            Conserver l’offre
          </Button>
        </div>
      </div>
      {error && <div className="form-status form-status--error" role="alert">{error}</div>}
    </section>
  );
}
