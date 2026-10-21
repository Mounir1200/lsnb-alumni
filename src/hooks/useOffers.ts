import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { demoOffers, getDemoOffer } from "../data/offers";
import { loadOffer, loadOffers, loadPublisherStatus, type Offer, type PublisherStatus } from "../lib/offerRepository";
import type { OfferAccess } from "./useOfferAccess";

type OffersState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; offers: Offer[]; publisher: PublisherStatus | null };

type OfferState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; offer: Offer | undefined };

const demoList: OffersState = { status: "ready", offers: demoOffers, publisher: null };

function useReload() {
  const [reloadKey, setReloadKey] = useState(0);
  return [reloadKey, () => setReloadKey((key) => key + 1)] as const;
}

/** Readable offers and whether the member may publish, loaded once access is known. */
export function useOffers(access: OfferAccess) {
  const { user } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState<OffersState>({ status: "loading" });
  const [reloadKey, retry] = useReload();

  useEffect(() => {
    if (access !== "member" || !userId) return;
    let active = true;
    setState({ status: "loading" });
    Promise.all([loadOffers(), loadPublisherStatus(userId)])
      .then(([offers, publisher]) => { if (active) setState({ status: "ready", offers, publisher }); })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [access, userId, reloadKey]);

  return { ...(access === "demo" ? demoList : state), retry };
}

export function useOffer(access: OfferAccess, offerId: string) {
  const { user } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState<OfferState & { offerId?: string }>({ status: "loading" });
  const [reloadKey, retry] = useReload();

  useEffect(() => {
    if (access !== "member" || !userId) return;
    let active = true;
    setState({ status: "loading" });
    loadOffer(offerId)
      .then((offer) => { if (active) setState({ status: "ready", offer, offerId }); })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [access, userId, offerId, reloadKey]);

  if (access === "demo") return { status: "ready" as const, offer: getDemoOffer(offerId), retry };
  // Never show the previous offer while the next one loads.
  if (state.status === "ready" && state.offerId !== offerId) return { status: "loading" as const, retry };
  return { ...state, retry };
}
