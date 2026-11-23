import { useCallback, useState } from "react";
import { initialCaptchaState, mountTurnstile, readSiteKey, withCaptcha, type CaptchaOptions, type CaptchaState } from "../../lib/turnstile";
import "./TurnstileField.css";

const SITE_KEY = readSiteKey(import.meta.env.VITE_TURNSTILE_SITE_KEY);

/** The anti-robot check of one form: its state, and `send`, which runs a Supabase Auth call with its token. */
export function useTurnstile() {
  const [state, setState] = useState<CaptchaState>(() => initialCaptchaState(SITE_KEY));
  const [round, setRound] = useState(0);
  const container = useCallback((element: HTMLDivElement | null) => (element && SITE_KEY ? mountTurnstile(element, SITE_KEY, setState) : undefined), []);
  const renew = useCallback(() => {
    setState(initialCaptchaState(SITE_KEY));
    setRound((value) => value + 1);
  }, []);
  const send = <T,>(call: (options: CaptchaOptions) => Promise<T>) => withCaptcha(state, renew, call);
  return { state, round, container, send };
}

export type Turnstile = ReturnType<typeof useTurnstile>;

/** Where the widget appears: nothing while the check is off or Cloudflare's script did not load. */
export function TurnstileField({ captcha }: { captcha: Turnstile }) {
  if (captcha.state.kind === "off" || captcha.state.kind === "unavailable") return null;
  // Each round gets a fresh element: the spent widget is removed and a new challenge starts.
  return <div key={captcha.round} ref={captcha.container} className="turnstile-field" />;
}
