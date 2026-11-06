/**
 * Rounds the trigger may start in one minute. Members cause at most one round
 * per request email; twenty in a minute means a leaked token or a loop.
 */
export const ROUNDS_PER_MINUTE = 20;
const WINDOW_MS = 60_000;

export type RoundSlot = { allowed: true } | { allowed: false; retryAfterSeconds: number };
export type RoundLimit = { take(): RoundSlot };

/** A fixed one-minute window, opened by the first round after the previous one ends. */
export function createRoundLimit(limit = ROUNDS_PER_MINUTE, now: () => number = Date.now): RoundLimit {
  let window: { start: number; taken: number } | undefined;
  return {
    take() {
      const time = now();
      if (!window || time - window.start >= WINDOW_MS) window = { start: time, taken: 0 };
      if (window.taken >= limit) return { allowed: false, retryAfterSeconds: Math.ceil((window.start + WINDOW_MS - time) / 1000) };
      window.taken += 1;
      return { allowed: true };
    },
  };
}
