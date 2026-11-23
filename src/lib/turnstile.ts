import { errorCode } from "./errorCode";

/**
 * The anti-robot check of the Supabase Auth forms (Cloudflare Turnstile). Supabase verifies each
 * token with Cloudflare once CAPTCHA protection is on in its dashboard. Without a site key the
 * forms show no widget and send no token, as before.
 */
export type CaptchaState =
  | { kind: "off" }
  | { kind: "waiting" }
  | { kind: "ready"; token: string }
  | { kind: "unavailable" };

/** Added to a Supabase Auth call's options: a token only when the check is on. */
export type CaptchaOptions = { captchaToken?: string };

export type TurnstileRenderOptions = {
  sitekey: string;
  language: "fr";
  theme: "light";
  size: "flexible" | "compact";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => boolean;
};

/** The part of Cloudflare's `window.turnstile` the forms use. */
export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** A flexible widget is never narrower than this; a narrower form gets the compact one. */
const FLEXIBLE_MIN_WIDTH_PX = 300;

const CAPTCHA_MESSAGES = new Map([
  ["captcha_waiting", "La vérification anti-robot n’est pas encore terminée. Patientez quelques secondes ou suivez ses indications, puis réessayez."],
  ["captcha_unavailable", "La vérification anti-robot n’a pas pu se charger. Vérifiez votre connexion internet, puis réessayez."],
  // Supabase's code when Cloudflare refuses the token.
  ["captcha_failed", "La vérification anti-robot a échoué. Patientez quelques secondes qu’elle recommence, puis réessayez."],
]);

export function readSiteKey(value: string | undefined): string | null {
  return value?.trim() || null;
}

export function initialCaptchaState(siteKey: string | null): CaptchaState {
  return siteKey ? { kind: "waiting" } : { kind: "off" };
}

/** Words a CAPTCHA problem, from the form or from Supabase, for members; undefined for any other error. */
export function captchaMessage(error: unknown): string | undefined {
  return CAPTCHA_MESSAGES.get(errorCode(error));
}

function notReady(code: "captcha_waiting" | "captcha_unavailable") {
  return Object.assign(new Error(CAPTCHA_MESSAGES.get(code)), { code });
}

/** Runs one Supabase Auth call with the token. A token is good for one call, so the widget starts over after it. */
export async function withCaptcha<T>(state: CaptchaState, renew: () => void, call: (options: CaptchaOptions) => Promise<T>): Promise<T> {
  if (state.kind === "off") return call({});
  if (state.kind === "waiting") throw notReady("captcha_waiting");
  if (state.kind === "unavailable") {
    renew(); // loads Cloudflare's script again
    throw notReady("captcha_unavailable");
  }
  try {
    return await call({ captchaToken: state.token });
  } finally {
    renew();
  }
}

function widgetOptions(siteKey: string, width: number, onChange: (state: CaptchaState) => void): TurnstileRenderOptions {
  return {
    sitekey: siteKey,
    language: "fr",
    theme: "light",
    size: width >= FLEXIBLE_MIN_WIDTH_PX ? "flexible" : "compact",
    callback: (token) => onChange({ kind: "ready", token }),
    "expired-callback": () => onChange({ kind: "waiting" }),
    // Turnstile retries by itself; true marks the error as handled, where it would otherwise throw.
    "error-callback": () => {
      onChange({ kind: "waiting" });
      return true;
    },
  };
}

/** Renders a widget in the element once Cloudflare's script is there; the returned function removes it. */
export function mountTurnstile(element: HTMLElement, siteKey: string, onChange: (state: CaptchaState) => void, load: () => Promise<TurnstileApi> = loadTurnstile) {
  let mounted = true;
  let removeWidget = () => {};
  load()
    .then((turnstile) => {
      if (!mounted) return;
      const widgetId = turnstile.render(element, widgetOptions(siteKey, element.clientWidth, onChange));
      if (!widgetId) throw new Error("Turnstile rendered no widget");
      removeWidget = () => turnstile.remove(widgetId);
    })
    .catch(() => {
      if (mounted) onChange({ kind: "unavailable" });
    });
  return () => {
    mounted = false;
    removeWidget();
  };
}

type ScriptPage = { createElement(tag: "script"): HTMLScriptElement; head: Pick<HTMLHeadElement, "append"> };

/** Loads Cloudflare's script once per page; after a failure, the next call tries again. */
export function createTurnstileLoader(page: ScriptPage, host: { turnstile?: TurnstileApi }) {
  let loading: Promise<TurnstileApi> | undefined;
  const inject = () => new Promise<TurnstileApi>((resolve, reject) => {
    const script = page.createElement("script");
    const fail = () => {
      script.remove();
      loading = undefined;
      reject(new Error("Cloudflare Turnstile is unavailable"));
    };
    script.src = TURNSTILE_SCRIPT_URL;
    script.onload = () => (host.turnstile ? resolve(host.turnstile) : fail());
    script.onerror = fail;
    page.head.append(script);
  });
  return () => (loading ??= inject());
}

let pageLoader: (() => Promise<TurnstileApi>) | undefined;

export function loadTurnstile() {
  pageLoader ??= createTurnstileLoader(document, window);
  return pageLoader();
}
