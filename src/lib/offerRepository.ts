import { supabase } from "./supabase";
import { createOfferRepository } from "./offerData";

export type { Offer, OfferDraft, OfferKind, PublisherStatus } from "./offerData";
export { OFFER_KINDS, OFFER_TEXT_LIMITS, isOfferExpired, toOfferDraft, todayIsoDate } from "./offerData";

export const {
  loadOffers,
  loadOffer,
  loadPublisherStatus,
  createOffer,
  updateOffer,
  deleteOffer,
  getOfferErrorMessage
} = createOfferRepository(supabase);
