import { useCallback, useEffect, useState } from "react";

const ONE_SECOND_MS = 1000;

/** Seconds left before an action may run again, such as asking for another email link. */
export function useCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!secondsLeft) return;
    const timeout = window.setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), ONE_SECOND_MS);
    return () => window.clearTimeout(timeout);
  }, [secondsLeft]);

  const start = useCallback((seconds: number) => setSecondsLeft(seconds), []);
  return { secondsLeft, start };
}
