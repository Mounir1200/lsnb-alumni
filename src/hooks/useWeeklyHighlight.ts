import { useEffect, useState } from "react";
import {
  currentHighlightWeek,
  loadCurrentHighlight,
  nextHighlightWeek,
  type WeeklyHighlight,
} from "../lib/highlightRepository";

type HighlightState =
  | { status: "loading"; highlight: null }
  | { status: "ready"; highlight: WeeklyHighlight }
  | { status: "empty"; highlight: null }
  | { status: "error"; highlight: null };

export function useWeeklyHighlight() {
  const [state, setState] = useState<HighlightState>({ status: "loading", highlight: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    let requestTimeout: number | undefined;
    let weekTimeout: number | undefined;
    let publicationRetryTimeout: number | undefined;
    let requestedWeek = currentHighlightWeek();
    let hasReadyHighlight = false;

    const isPublicationWindow = () => {
      const now = new Date();
      return now.getUTCDay() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() < 25;
    };

    const schedulePublicationRetry = () => {
      window.clearTimeout(publicationRetryTimeout);
      if (!active || hasReadyHighlight || document.visibilityState !== "visible" || !isPublicationWindow()) return;
      publicationRetryTimeout = window.setTimeout(() => {
        if (active && document.visibilityState === "visible" && isPublicationWindow()) void load();
      }, 30_000);
    };

    const load = async (preserveReady = false) => {
      controller?.abort();
      window.clearTimeout(requestTimeout);
      window.clearTimeout(publicationRetryTimeout);
      const request = new AbortController();
      controller = request;
      const nextWeek = currentHighlightWeek();
      if (!preserveReady || requestedWeek !== nextWeek || !hasReadyHighlight) {
        hasReadyHighlight = false;
        setState({ status: "loading", highlight: null });
      }
      requestedWeek = nextWeek;
      let timedOut = false;
      requestTimeout = window.setTimeout(() => {
        timedOut = true;
        request.abort();
      }, 15_000);

      try {
        const highlight = await loadCurrentHighlight(request.signal);
        if (!active || request !== controller) return;
        hasReadyHighlight = Boolean(highlight);
        setState(highlight ? { status: "ready", highlight } : { status: "empty", highlight: null });
      } catch {
        if (active && request === controller && (!request.signal.aborted || timedOut)) {
          hasReadyHighlight = false;
          setState({ status: "error", highlight: null });
        }
      } finally {
        if (request === controller) {
          window.clearTimeout(requestTimeout);
          schedulePublicationRetry();
        }
      }
    };

    const scheduleWeekChange = () => {
      window.clearTimeout(weekTimeout);
      weekTimeout = window.setTimeout(() => {
        void load();
        scheduleWeekChange();
      }, Math.max(1_000, nextHighlightWeek(currentHighlightWeek()) - Date.now() + 100));
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(publicationRetryTimeout);
        return;
      }
      // A suspended background tab may have missed the Monday timer.
      if (requestedWeek !== currentHighlightWeek()) scheduleWeekChange();
      void load(true);
    };

    void load();
    scheduleWeekChange();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(requestTimeout);
      window.clearTimeout(weekTimeout);
      window.clearTimeout(publicationRetryTimeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reloadKey]);

  return { ...state, retry: () => setReloadKey((key) => key + 1) };
}
