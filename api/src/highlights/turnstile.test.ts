import assert from "node:assert/strict";
import test from "node:test";
import { getLoginError, resendSignupConfirmation } from "../../../src/lib/emailConfirmation.ts";
import { requestPasswordReset } from "../../../src/lib/passwordRecovery.ts";
import {
  captchaMessage, createTurnstileLoader, initialCaptchaState, mountTurnstile, readSiteKey, withCaptcha,
  type CaptchaState, type TurnstileApi, type TurnstileRenderOptions,
} from "../../../src/lib/turnstile.ts";

// Cloudflare's always-pass test site key, and the token its widget hands out.
const SITE_KEY = "1x00000000000000000000AA";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const CALLBACK = "https://network.example.test/auth/callback";
const EMAIL = "member@example.test";

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("without a site key the check is off, so the forms work as before", () => {
  for (const value of [undefined, "", "  "]) assert.deepEqual(initialCaptchaState(readSiteKey(value)), { kind: "off" });
  assert.equal(readSiteKey(` ${SITE_KEY}\n`), SITE_KEY);
  assert.deepEqual(initialCaptchaState(SITE_KEY), { kind: "waiting" });
});

/** One submission of a form whose check is in `state`. */
function submit(state: CaptchaState, outcome: () => Promise<string> = async () => "done") {
  const sent: unknown[] = [];
  let renewals = 0;
  const result = withCaptcha(state, () => { renewals += 1; }, (options) => { sent.push(options); return outcome(); });
  return { result, sent, renewals: () => renewals };
}

test("a ready check sends its token with one Supabase Auth call, then starts a fresh challenge", async () => {
  const { result, sent, renewals } = submit({ kind: "ready", token: TOKEN });
  assert.equal(await result, "done");
  assert.deepEqual(sent, [{ captchaToken: TOKEN }]);
  assert.equal(renewals(), 1);
});

test("a token is spent even by a call that fails", async () => {
  const { result, renewals } = submit({ kind: "ready", token: TOKEN }, async () => { throw new Error("invalid_credentials"); });
  await assert.rejects(result, /invalid_credentials/);
  assert.equal(renewals(), 1);
});

test("with the check off, a call carries no token and nothing restarts", async () => {
  const { result, sent, renewals } = submit({ kind: "off" });
  assert.equal(await result, "done");
  assert.deepEqual(sent, [{}]);
  assert.equal(renewals(), 0);
});

test("a form waits for an unfinished check instead of sending a request Supabase would refuse", async () => {
  const { result, sent, renewals } = submit({ kind: "waiting" });
  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /pas encore terminée/);
    assert.equal(captchaMessage(error), error.message);
    return true;
  });
  assert.deepEqual(sent, []);
  assert.equal(renewals(), 0, "a challenge still running is left alone");
});

test("when Cloudflare's script did not load, the form says so and loads it again", async () => {
  const { result, sent, renewals } = submit({ kind: "unavailable" });
  await assert.rejects(result, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /n’a pas pu se charger/);
    assert.equal(captchaMessage(error), error.message);
    return true;
  });
  assert.deepEqual(sent, []);
  assert.equal(renewals(), 1);
});

test("a CAPTCHA that Supabase refused is worded for members; other errors are left to their form", () => {
  const refused = { code: "captcha_failed", message: "captcha protection: request disallowed (timeout-or-duplicate)" };
  assert.match(captchaMessage(refused) ?? "", /vérification anti-robot a échoué/);
  for (const error of [{ code: "invalid_credentials" }, new Error("captcha_failed"), { code: "constructor" }, null]) {
    assert.equal(captchaMessage(error), undefined, String(error));
  }
});

test("confirmation resends and reset links carry the form's token", async () => {
  const calls: unknown[][] = [];
  const record = async (...args: unknown[]) => { calls.push(args); return { error: null }; };
  const auth = { resend: record, resetPasswordForEmail: record } as never;
  await resendSignupConfirmation(auth, EMAIL, CALLBACK, { captchaToken: TOKEN });
  await requestPasswordReset(auth, EMAIL, CALLBACK, { captchaToken: TOKEN });
  assert.deepEqual(calls, [
    [{ type: "signup", email: EMAIL, options: { emailRedirectTo: CALLBACK, captchaToken: TOKEN } }],
    [EMAIL, { redirectTo: CALLBACK, captchaToken: TOKEN }],
  ]);
});

test("sign-in, confirmation resends and reset links explain a CAPTCHA that Supabase refused, without its English detail", async () => {
  const refused = { code: "captcha_failed", message: "captcha protection: request disallowed (timeout-or-duplicate)" };
  const explains = (message: string) => {
    assert.match(message, /vérification anti-robot a échoué/);
    assert.doesNotMatch(message, /captcha protection/);
  };
  explains(getLoginError(refused));
  const auth = { resend: async () => ({ error: refused }), resetPasswordForEmail: async () => ({ error: refused }) } as never;
  for (const request of [resendSignupConfirmation(auth, EMAIL, CALLBACK, {}), requestPasswordReset(auth, EMAIL, CALLBACK, {})]) {
    await assert.rejects(request, (error: unknown) => {
      assert.ok(error instanceof Error);
      explains(error.message);
      return true;
    });
  }
});

function fakeTurnstile() {
  const rendered: TurnstileRenderOptions[] = [];
  const removed: string[] = [];
  const turnstile: TurnstileApi = {
    render: (_container, options) => { rendered.push(options); return `widget-${rendered.length}`; },
    remove: (widgetId) => { removed.push(widgetId); },
  };
  return { turnstile, rendered, removed };
}

function mount(width: number, load: () => Promise<TurnstileApi>) {
  const states: CaptchaState[] = [];
  const unmount = mountTurnstile({ clientWidth: width } as HTMLElement, SITE_KEY, (state) => { states.push(state); }, load);
  return { states, unmount };
}

test("the widget speaks French, matches the light pages and spans the form when it fits", async () => {
  const { turnstile, rendered } = fakeTurnstile();
  mount(300, async () => turnstile);
  mount(299, async () => turnstile);
  await settled();
  assert.deepEqual(rendered.map(({ sitekey, language, theme, size }) => ({ sitekey, language, theme, size })), [
    { sitekey: SITE_KEY, language: "fr", theme: "light", size: "flexible" },
    { sitekey: SITE_KEY, language: "fr", theme: "light", size: "compact" },
  ]);
});

test("the widget tells its form about each token, each expiry and each error", async () => {
  const { turnstile, rendered } = fakeTurnstile();
  const { states } = mount(320, async () => turnstile);
  await settled();
  const options = rendered[0]!;
  options.callback(TOKEN);
  options["expired-callback"]();
  options.callback("second-token");
  assert.equal(options["error-callback"](), true, "a handled error: Turnstile retries instead of throwing");
  assert.deepEqual(states, [
    { kind: "ready", token: TOKEN }, { kind: "waiting" }, { kind: "ready", token: "second-token" }, { kind: "waiting" },
  ]);
});

test("a form that goes away removes its widget, even one whose script is still on its way", async () => {
  const { turnstile, rendered, removed } = fakeTurnstile();
  const shown = mount(320, async () => turnstile);
  await settled();
  shown.unmount();
  assert.deepEqual(removed, ["widget-1"]);

  let arrive: (api: TurnstileApi) => void = () => {};
  const late = mount(320, () => new Promise((resolve) => { arrive = resolve; }));
  late.unmount();
  arrive(turnstile);
  await settled();
  assert.equal(rendered.length, 1, "nothing renders into a form that is gone");
  assert.deepEqual(late.states, []);
});

test("a script that cannot load or render leaves the check unavailable", async () => {
  const blocked = mount(320, async () => { throw new Error("blocked"); });
  const broken = mount(320, async () => ({ render: () => undefined, remove: () => {} }));
  const gone = mount(320, async () => { throw new Error("blocked"); });
  gone.unmount();
  await settled();
  assert.deepEqual(blocked.states, [{ kind: "unavailable" }]);
  assert.deepEqual(broken.states, [{ kind: "unavailable" }]);
  assert.deepEqual(gone.states, [], "a form that is gone hears nothing");
});

type FakeScript = { src: string; removed: boolean; onload?: () => void; onerror?: () => void; remove(): void };

function fakePage() {
  const scripts: FakeScript[] = [];
  const host: { turnstile?: TurnstileApi } = {};
  const page = {
    createElement(tag: string) {
      assert.equal(tag, "script");
      const script: FakeScript = { src: "", removed: false, remove() { script.removed = true; } };
      return script;
    },
    head: { append(script: FakeScript) { scripts.push(script); } },
  };
  return { load: createTurnstileLoader(page as unknown as Parameters<typeof createTurnstileLoader>[0], host), scripts, host };
}

test("Cloudflare's script is fetched once, from Cloudflare, for every form of the page", async () => {
  const { load, scripts, host } = fakePage();
  const { turnstile } = fakeTurnstile();
  const first = load();
  const second = load();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0]!.src, "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  host.turnstile = turnstile;
  scripts[0]!.onload!();
  assert.equal(await first, turnstile);
  assert.equal(await second, turnstile);
  assert.equal(await load(), turnstile);
  assert.equal(scripts.length, 1);
});

test("a script that failed, or loaded without Turnstile, is removed and fetched again by the next form", async () => {
  const { load, scripts } = fakePage();
  const failed = load();
  scripts[0]!.onerror!();
  await assert.rejects(failed);
  assert.equal(scripts[0]!.removed, true);

  const empty = load();
  assert.equal(scripts.length, 2);
  scripts[1]!.onload!();
  await assert.rejects(empty);
  assert.equal(scripts[1]!.removed, true);

  void load();
  assert.equal(scripts.length, 3);
});
