import type { SupabaseClient } from "@supabase/supabase-js";
import { mapMemberSummary, memberColumns, type MemberRow, type MemberSummary } from "./memberSummary";
import { collectRowsById, isUuid } from "./pagedRows";
import { getSafeProfileLink, normalizeProfileLink } from "./profileLinks";

export const OFFER_KINDS = ["internship", "scholarship", "admission"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

// Keep aligned with the CHECK constraints of public.offers.
export const OFFER_TEXT_LIMITS = {
  title: { min: 5, max: 120 },
  organization: { min: 2, max: 120 },
  location: { min: 0, max: 120 },
  description: { min: 30, max: 3000 },
} as const;

type OfferTextField = keyof typeof OFFER_TEXT_LIMITS;

const offerFieldLabels: Record<OfferTextField, string> = {
  title: "L’intitulé",
  organization: "L’organisme",
  location: "Le lieu",
  description: "La description",
};

export type Offer = {
  id: string;
  authorId: string;
  kind: OfferKind;
  title: string;
  organization: string;
  location: string;
  description: string;
  linkUrl?: string;
  deadline: string | null;
  createdAt: string;
  author: MemberSummary | null;
  isDemo?: boolean;
};

export type OfferDraft = Pick<Offer, "kind" | "title" | "organization" | "location" | "description"> & {
  linkUrl: string;
  deadline: string;
};

/** Mirrors the database rule: only active alumni who offer mentoring publish. */
export type PublisherStatus = "publisher" | "mentoring-off" | "student" | "inactive";

type OfferRow = {
  id: string; author_id: string; kind: OfferKind; title: string; organization: string; location: string;
  description: string; link_url: string | null; deadline: string | null; created_at: string;
  author: MemberRow | null;
};

const offerColumns = `id, author_id, kind, title, organization, location, description, link_url, deadline, created_at,
  author:profiles!offers_author_id_fkey(${memberColumns})`;

const OFFERS_PAGE_SIZE = 100;

/** The database compares deadlines with current_date in UTC, Burkina Faso's time zone. */
export function todayIsoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isOfferExpired(offer: Pick<Offer, "deadline">, today = todayIsoDate()) {
  return offer.deadline !== null && offer.deadline < today;
}

class OfferActionError extends Error {}

function characterCount(value: string) {
  return [...value].length;
}

function checkLength(field: OfferTextField, value: string) {
  const { min, max } = OFFER_TEXT_LIMITS[field];
  const length = characterCount(value);
  if (length < min || length > max) {
    throw new OfferActionError(min > 0
      ? `${offerFieldLabels[field]} doit contenir entre ${min} et ${max.toLocaleString("fr-FR")} caractères.`
      : `${offerFieldLabels[field]} doit contenir au maximum ${max.toLocaleString("fr-FR")} caractères.`);
  }
  return value;
}

/** A past deadline is accepted only when an edit leaves the stored one unchanged. */
export function normalizeOfferDraft(draft: OfferDraft, storedDeadline: string | null = null) {
  if (!OFFER_KINDS.includes(draft.kind)) throw new OfferActionError("Choisissez le type d’offre.");
  const deadline = draft.deadline.trim() || null;
  if (deadline !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new OfferActionError("La date limite n’est pas valide.");
    if (deadline < todayIsoDate() && deadline !== storedDeadline) {
      throw new OfferActionError("La date limite ne peut pas être déjà passée.");
    }
  }
  let linkUrl: string | null;
  try {
    linkUrl = normalizeProfileLink(draft.linkUrl, "offer");
  } catch (error) {
    throw new OfferActionError(error instanceof Error ? error.message : "Le lien de l’offre n’est pas valide.");
  }
  return {
    kind: draft.kind,
    title: checkLength("title", draft.title.trim()),
    organization: checkLength("organization", draft.organization.trim()),
    location: checkLength("location", draft.location.trim()),
    description: checkLength("description", draft.description.trim()),
    link_url: linkUrl,
    deadline,
  };
}

export function toOfferDraft(offer: Offer): OfferDraft {
  return {
    kind: offer.kind, title: offer.title, organization: offer.organization, location: offer.location,
    description: offer.description, linkUrl: offer.linkUrl ?? "", deadline: offer.deadline ?? "",
  };
}

export function createOfferRepository(supabase: SupabaseClient | null) {
  function client() {
    if (!supabase) throw new OfferActionError("Les offres sont indisponibles pour le moment.");
    return supabase;
  }

  function checkedId(id: string) {
    if (!isUuid(id)) throw new OfferActionError("Cette offre est introuvable.");
    return id;
  }

  function mapOffer(row: OfferRow): Offer {
    return {
      id: row.id, authorId: row.author_id, kind: row.kind, title: row.title, organization: row.organization,
      location: row.location, description: row.description,
      // Stored links were validated on write; this keeps a malformed one from becoming clickable.
      linkUrl: getSafeProfileLink(row.link_url, "offer"),
      deadline: row.deadline, createdAt: row.created_at, author: mapMemberSummary(row.author),
    };
  }

  /** Offers the member may read: published ones plus their own, hidden or expired. */
  async function loadOffers(): Promise<Offer[]> {
    const db = client();
    const rows = await collectRowsById((before) => {
      const query = db.from("offers").select(offerColumns).order("id", { ascending: false }).limit(OFFERS_PAGE_SIZE);
      return before ? query.lt("id", before) : query;
    });
    return (rows as OfferRow[]).map(mapOffer);
  }

  async function loadOffer(offerId: string): Promise<Offer | undefined> {
    if (!isUuid(offerId)) return undefined;
    const { data, error } = await client().from("offers").select(offerColumns).eq("id", offerId).maybeSingle();
    if (error) throw error;
    // Without generated types the client infers to-one joins as arrays.
    return data ? mapOffer(data as unknown as OfferRow) : undefined;
  }

  async function loadPublisherStatus(userId: string): Promise<PublisherStatus> {
    const { data, error } = await client().from("profiles")
      .select("member_role, offers_mentoring, is_active, profile_completed").eq("id", checkedId(userId)).maybeSingle();
    if (error) throw error;
    if (!data?.is_active || !data.profile_completed) return "inactive";
    if (data.member_role !== "alumni") return "student";
    return data.offers_mentoring ? "publisher" : "mentoring-off";
  }

  async function createOffer(userId: string, draft: OfferDraft): Promise<string> {
    const { data, error } = await client().from("offers")
      .insert({ author_id: checkedId(userId), ...normalizeOfferDraft(draft) }).select("id").single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async function updateOffer(offer: Pick<Offer, "id" | "deadline">, draft: OfferDraft): Promise<void> {
    const { data, error } = await client().from("offers").update(normalizeOfferDraft(draft, offer.deadline))
      .eq("id", checkedId(offer.id)).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new OfferActionError("Cette offre n’existe plus ou ne vous appartient pas.");
  }

  async function deleteOffer(offerId: string): Promise<void> {
    const { data, error } = await client().from("offers").delete().eq("id", checkedId(offerId)).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new OfferActionError("Cette offre a déjà été supprimée ou ne vous appartient pas.");
  }

  function getOfferErrorMessage(error: unknown): string {
    if (error instanceof OfferActionError) return error.message;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "42501") return "Seuls les alumni qui proposent du mentorat peuvent publier une offre. Vérifiez votre profil.";
    if (code === "23514" || code === "22023") {
      return "Vérifiez l’offre : longueur des champs, lien HTTPS public et date limite à venir.";
    }
    return "Impossible d’enregistrer l’offre. Réessayez dans un instant.";
  }

  return { loadOffers, loadOffer, loadPublisherStatus, createOffer, updateOffer, deleteOffer, getOfferErrorMessage };
}
