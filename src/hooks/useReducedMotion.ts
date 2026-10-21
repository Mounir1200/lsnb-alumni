import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

// Read on the first render: starting from `false` would launch entrance animations
// that get interrupted mid-way as soon as the real preference arrives.
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, prefersReducedMotion);
}
