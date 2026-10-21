import { CalendarClock } from "lucide-react";
import { isOfferExpired, todayIsoDate, type Offer, type OfferKind } from "../../lib/offerRepository";
import { cn } from "../../lib/cn";

export const offerKindLabels: Record<OfferKind, string> = {
  internship: "Stage",
  scholarship: "Bourse",
  admission: "Admission universitaire",
};

export const offerKindPluralLabels: Record<OfferKind, string> = {
  internship: "Stages",
  scholarship: "Bourses",
  admission: "Admissions",
};

const DEADLINE_SOON_DAYS = 7;
const DAY_IN_MS = 86_400_000;

// Deadlines are calendar dates compared in UTC, like the database.
export function formatOfferDate(isoDate: string) {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function daysUntil(deadline: string, today: string) {
  return Math.round((Date.parse(deadline) - Date.parse(today)) / DAY_IN_MS);
}

export function OfferKindTag({ kind }: { kind: OfferKind }) {
  return <span className={`offer-tag offer-tag--${kind}`}>{offerKindLabels[kind]}</span>;
}

export function OfferDeadline({ offer }: { offer: Pick<Offer, "deadline"> }) {
  const today = todayIsoDate();
  if (!offer.deadline) return <span className="offer-deadline">Sans date limite</span>;
  if (isOfferExpired(offer, today)) {
    return <span className="offer-deadline offer-deadline--expired">Clôturée le {formatOfferDate(offer.deadline)}</span>;
  }
  const isSoon = daysUntil(offer.deadline, today) <= DEADLINE_SOON_DAYS;
  return (
    <span className={cn("offer-deadline", isSoon && "offer-deadline--soon")}>
      <CalendarClock size={14} aria-hidden="true" />
      Jusqu’au {formatOfferDate(offer.deadline)}
    </span>
  );
}

/** Own offers come back from the database even while hidden from other members. */
export function isOfferHidden(offer: Pick<Offer, "author">) {
  return offer.author?.memberRole !== "alumni" || !offer.author.offersMentoring;
}
