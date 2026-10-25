import assert from "node:assert/strict";
import test from "node:test";
import { getSafeNextPath, getPostAuthPath, getProfileCompletionPath } from "../../../src/lib/auth.ts";
import { callbackError, legacyCallbackPath, resolveCallbackUser } from "../../../src/lib/authCallback.ts";
import { beginGoogleOAuth } from "../../../src/lib/googleOAuth.ts";
import { registerEmailAccount } from "../../../src/lib/emailConfirmation.ts";

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
    setSession: async () => { calls.push("setSession"); return { data: { session: { user }, user }, error: null }; },
  } as unknown as Parameters<typeof resolveCallbackUser>[0];
  return { auth, calls, user, withoutSession: () => { session = null; }, invalidInitialization: () => { initializationError = new Error("raw provider detail"); } };
}

function isolatedLinkAuth(session: unknown) {
  const revoked: unknown[] = [];
  const auth = {
    verifyOtp: async () => ({ data: { session }, error: null }),
    signOut: async (options: unknown) => { revoked.push(options); return { error: null }; },
  } as any;
  return { createAuth: () => auth, revoked };
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
  await assert.rejects(resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?code=bad")), /n’est plus valide/);
  assert.deepEqual(fixture.calls, ["initialize"]);
});

test("restored OAuth sessions are reused with no second code exchange", async () => {
  const fixture = authFixture();
  assert.deepEqual(await resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?code=already-handled"), () => new URL("https://site.test/auth/callback")), fixture.user);
  assert.deepEqual(fixture.calls, ["initialize", "getSession"]);
});

test("email links require explicit confirmation before the shared session changes", async () => {
  const fixture = authFixture();
  fixture.withoutSession();
  const link = isolatedLinkAuth({ user: fixture.user, access_token: "access", refresh_token: "refresh" });
  const user = await resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?token_hash=email-token&type=signup"), undefined, {
    createAuth: link.createAuth,
    confirmAccount: async (account) => { assert.equal(account.email, fixture.user.email); assert.deepEqual(fixture.calls, []); return true; },
  });
  assert.deepEqual(user, fixture.user);
  assert.deepEqual(fixture.calls, ["setSession"]);
  assert.deepEqual(link.revoked, []);
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

test("unconfirmed email and legacy token links cannot replace an existing account", async () => {
  const fixture = authFixture();
  for (const suffix of ["?token_hash=new-account&type=signup", "#access_token=other&refresh_token=other", "?%61ccess_token=other&refresh_token=other", "?access_token=a#refresh_token=b"]) {
    await assert.rejects(resolveCallbackUser(fixture.auth, new URL(`https://site.test/auth/callback${suffix}`)), /n’est pas valide/);
  }
  assert.deepEqual(fixture.calls, []);
});

test("declining a verified account revokes the link session and leaves the shared session untouched", async () => {
  const fixture = authFixture();
  const link = isolatedLinkAuth({ user: fixture.user });
  await assert.rejects(resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback?token_hash=other&type=email"), undefined, {
    createAuth: link.createAuth,
    confirmAccount: async () => false,
  }), /annulée/);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(link.revoked, [{ scope: "local" }]);
});

test("a confirmed link session that cannot be installed is revoked", async () => {
  const fixture = authFixture();
  const link = isolatedLinkAuth({ user: fixture.user, access_token: "access", refresh_token: "refresh" });
  const auth = { ...fixture.auth, setSession: async () => ({ data: { session: null, user: null }, error: new Error("network") }) } as unknown as typeof fixture.auth;
  await assert.rejects(resolveCallbackUser(auth, new URL("https://site.test/auth/callback?token_hash=email-token&type=signup"), undefined, {
    createAuth: link.createAuth,
    confirmAccount: async () => true,
  }), /n’a pas pu être ouverte/);
  assert.deepEqual(link.revoked, [{ scope: "local" }]);
});

test("legacy tokens are verified in isolation before account confirmation", async () => {
  const fixture = authFixture();
  const candidate = { user: fixture.user, access_token: "access", refresh_token: "refresh" };
  const result = await resolveCallbackUser(fixture.auth, new URL("https://site.test/auth/callback#access_token=access&refresh_token=refresh"), undefined, {
    createAuth: () => ({ setSession: async (tokens: unknown) => { assert.deepEqual(tokens, { access_token: "access", refresh_token: "refresh" }); return { data: { session: candidate }, error: null }; } }) as any,
    confirmAccount: async () => { assert.deepEqual(fixture.calls, []); return true; },
  });
  assert.deepEqual(result, fixture.user);
  assert.deepEqual(fixture.calls, ["setSession"]);
});

test("Google OAuth requests only identity scopes with the app callback and account chooser", async () => {
  let input: unknown;
  const auth = { signInWithOAuth: async (args: unknown) => { input = args; return { data: { url: "https://accounts.google.com" }, error: null }; } } as unknown as Parameters<typeof beginGoogleOAuth>[0];
  await beginGoogleOAuth(auth, "https://site.test/auth/callback?next=%2Fannuaire");
  assert.deepEqual(input, { provider: "google", options: {
    redirectTo: "https://site.test/auth/callback?next=%2Fannuaire", scopes: "openid email profile", queryParams: { prompt: "select_account" },
  } });
});

test("email registration preserves both confirmation-required and autoconfirmed signup behavior", async () => {
  for(const immediateSession of [false,true]) {
    const fixture=authFixture();
    const session=immediateSession?{user:fixture.user,access_token:"access",refresh_token:"refresh"}:null;
    const credentials={email:fixture.user.email,password:"submitted-password"};
    const result=await registerEmailAccount(fixture.auth,{signUp:async(input:unknown)=>{
      assert.deepEqual(input,credentials);return {data:{user:fixture.user,session},error:null};
    }} as any,credentials);
    assert.deepEqual(result.data.session,session);
    assert.equal(result.signInRequired,false);
    assert.deepEqual(fixture.calls,immediateSession?["setSession"]:[]);
  }
});

test("an autoconfirmed account whose session cannot be installed asks for a sign-in instead of failing", async () => {
  const fixture = authFixture();
  const session = { user: fixture.user, access_token: "access", refresh_token: "refresh" };
  const auth = { setSession: async () => ({ data: { session: null, user: null }, error: new Error("network") }) } as any;
  const signupAuth = { signUp: async () => ({ data: { user: fixture.user, session }, error: null }) } as any;
  const result = await registerEmailAccount(auth, signupAuth, { email: fixture.user.email, password: "submitted-password" });
  assert.equal(result.error, null);
  assert.equal(result.data.session, null);
  assert.deepEqual(result.data.user, fixture.user);
  assert.equal(result.signInRequired, true);
});

test("legacy root returns reach the callback without resending an exchanged code", () => {
  const at = (suffix: string) => new URL(`https://site.test/${suffix}`);
  assert.equal(legacyCallbackPath(at("?code=pkce&next=%2Fannuaire"), at("?code=pkce&next=%2Fannuaire")), "/auth/callback?code=pkce&next=%2Fannuaire");
  assert.equal(legacyCallbackPath(at("?code=pkce&next=%2Fannuaire"), at("?next=%2Fannuaire")), "/auth/callback?next=%2Fannuaire");
  assert.equal(legacyCallbackPath(at("?token_hash=link&type=signup"), at("?token_hash=link&type=signup")), "/auth/callback?token_hash=link&type=signup");
  assert.equal(legacyCallbackPath(at("#access_token=a&refresh_token=b"), at("#access_token=a&refresh_token=b")), "/auth/callback#access_token=a&refresh_token=b");
  assert.equal(legacyCallbackPath(at("?ref=newsletter"), at("?ref=newsletter")), null);
  assert.equal(legacyCallbackPath(at("annuaire?code=pkce"), at("annuaire?code=pkce")), null);
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
