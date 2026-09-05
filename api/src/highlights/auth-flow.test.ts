import assert from "node:assert/strict";
import test from "node:test";
import { getSafeNextPath, getPostAuthPath, getProfileCompletionPath } from "../../../src/lib/auth.ts";
import { callbackError, resolveCallbackUser } from "../../../src/lib/authCallback.ts";
import { beginGoogleOAuth } from "../../../src/lib/googleOAuth.ts";

test("return paths keep local queries and fragments while rejecting external redirect bypasses", () => {
  assert.equal(getSafeNextPath("/alumni/member?mentor=true#contact"), "/alumni/member?mentor=true#contact");
  for (const path of [null, "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test", "/\nevil", "/%00evil", "/bad%", "javascript:alert(1)"]) {
    assert.equal(getSafeNextPath(path), "/espace", String(path));
  }
  assert.equal(getPostAuthPath("/auth/callback?next=/connexion"), "/espace");
  assert.equal(getPostAuthPath("/completer-profil"), "/espace");
  for (const path of ["/completer-profil/", "/COMPLETER-PROFIL", "/%63onnexion/", "/auth/callback//"]) {
    assert.equal(getPostAuthPath(path), "/espace", path);
  }
  assert.equal(getProfileCompletionPath("/annuaire?mentor=true"), "/completer-profil?next=%2Fannuaire%3Fmentor%3Dtrue");
});

function authFixture() {
  const calls: string[] = [];
  const user = { id: "member-1", email: "member@example.test" };
  let session: unknown = { user };
  let initializationError: unknown = null;
  const auth = {
    initialize: async () => { calls.push("initialize"); return { error: initializationError }; },
    getSession: async () => { calls.push("getSession"); return { data: { session }, error: null }; },
    verifyOtp: async () => { calls.push("verifyOtp"); return { data: { session: { user } }, error: null }; },
  } as unknown as Parameters<typeof resolveCallbackUser>[0];
  return { auth, calls, user, withoutSession: () => { session = null; }, invalidInitialization: () => { initializationError = new Error("raw provider detail"); } };
}

test("provider refusal beats an existing session and never displays raw error text", async () => {
  const { auth, calls } = authFixture();
  const url = new URL("https://site.test/auth/callback?error=access_denied&error_description=private-detail");
  await assert.rejects(resolveCallbackUser(auth, url), /annulée ou refusée/);
  assert.equal(calls.length, 0);
  assert.equal(callbackError(url)?.includes("private-detail"), false);
  assert.ok(callbackError(new URL("https://site.test/auth/callback#error=access_denied")));
});

test("SDK initialization failures cannot turn into success with an old session", async () => {
  const fixture = authFixture();
  fixture.invalidInitialization();
  await assert.rejects(resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback#access_token=bad")), /n’est plus valide/);
  assert.deepEqual(fixture.calls, ["initialize"]);
});

test("restored OAuth sessions are reused with no second code exchange", async () => {
  const fixture = authFixture();
  assert.deepEqual(await resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?code=already-handled"), () => new URL("https://site.test/auth/callback")), fixture.user);
  assert.deepEqual(fixture.calls, ["initialize", "getSession"]);
});

test("email token-hash confirmations keep working", async () => {
  const fixture = authFixture();
  fixture.withoutSession();
  assert.deepEqual(await resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?token_hash=email-token&type=signup")), fixture.user);
  assert.deepEqual(fixture.calls, ["initialize", "verifyOtp"]);
});

test("missing sessions and unsupported OTP types do not invent successful login", async () => {
  const fixture = authFixture();
  fixture.withoutSession();
  await assert.rejects(resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?token_hash=test&type=sms")), /n’est pas valide/);
  assert.equal(fixture.calls.includes("verifyOtp"), false);
});

test("unconsumed codes cannot silently reuse an unrelated existing account", async () => {
  const fixture = authFixture();
  await assert.rejects(resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?code=unrecognized")), /ce navigateur/);
  assert.deepEqual(fixture.calls, ["initialize"]);
});

test("email confirmation is verified even when another user already has a session", async () => {
  const fixture = authFixture();
  await resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?token_hash=new-account&type=signup"));
  assert.deepEqual(fixture.calls, ["initialize", "verifyOtp"]);
});

test("Google OAuth requests only identity scopes with the app callback and account chooser", async () => {
  let input: unknown;
  const auth = { signInWithOAuth: async (args: unknown) => { input = args; return { data: { url: "https://accounts.google.com" }, error: null }; } } as unknown as Parameters<typeof beginGoogleOAuth>[0];
  await beginGoogleOAuth(auth, "https://site.test/auth/callback?next=%2Fannuaire");
  assert.deepEqual(input, { provider: "google", options: {
    redirectTo: "https://site.test/auth/callback?next=%2Fannuaire", scopes: "openid email profile", queryParams: { prompt: "select_account" },
  } });
});

test("OAuth error responses and thrown network errors restore a safe user-facing failure", async () => {
  for (const fail of [
    async () => ({ data: { url: null }, error: { message: "raw secret detail" } }),
    async () => { throw new Error("raw secret detail"); },
  ]) {
    const auth = { signInWithOAuth: fail } as unknown as Parameters<typeof beginGoogleOAuth>[0];
    await assert.rejects(beginGoogleOAuth(auth, "https://site.test/auth/callback"), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Réessayez/);
      assert.equal(error.message.includes("raw secret"), false);
      return true;
    });
  }
});
