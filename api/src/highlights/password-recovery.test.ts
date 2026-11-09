import assert from "node:assert/strict";
import test from "node:test";
import { callbackError } from "../../../src/lib/authCallback.ts";
import {
  FORGOT_PASSWORD_PATH, NEW_PASSWORD_PATH, RESET_LINK_SENT, emailFromRouterState, isPasswordResetReturn, requestPasswordReset,
  savedPasswordMessage, updatePassword,
} from "../../../src/lib/passwordRecovery.ts";

type ResetAuth = Parameters<typeof requestPasswordReset>[0];
type PasswordAuth = Parameters<typeof updatePassword>[0];
type AuthResult = () => Promise<{ error: unknown }>;

const CALLBACK = "https://network.example.test/auth/callback?next=%2Fnouveau-mot-de-passe";
const NEW_PASSWORD = "nouveau-secret-42";
const succeeds: AuthResult = async () => ({ error: null });

function resetAuth(result: AuthResult) {
  const calls: unknown[][] = [];
  const auth = { resetPasswordForEmail: async (...args: unknown[]) => { calls.push(args); return result(); } } as unknown as ResetAuth;
  return { auth, calls };
}

function passwordAuth(update: AuthResult, signOut: AuthResult = succeeds) {
  const calls: unknown[][] = [];
  const auth = {
    updateUser: async (...args: unknown[]) => { calls.push(["updateUser", ...args]); return update(); },
    signOut: async (...args: unknown[]) => { calls.push(["signOut", ...args]); return signOut(); },
  } as unknown as PasswordAuth;
  return { auth, calls };
}

function rejectsWithout(secret: RegExp, expected: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, expected);
    assert.doesNotMatch(error.message, secret);
    return true;
  };
}

test("a reset request sends the link to the trimmed address and comes back to the new password page", async () => {
  const { auth, calls } = resetAuth(succeeds);
  await requestPasswordReset(auth, "  member@example.test ", CALLBACK);
  assert.deepEqual(calls, [["member@example.test", { redirectTo: CALLBACK }]]);
  assert.match(RESET_LINK_SENT, /^Si un compte existe/);
});

test("a reset request checks the address before contacting the server", async () => {
  const { auth, calls } = resetAuth(succeeds);
  for (const email of ["", "member", "member@", "a b@example.test"]) {
    await assert.rejects(requestPasswordReset(auth, email, CALLBACK), /adresse e-mail valide/);
  }
  assert.equal(calls.length, 0);
});

test("reset request failures say what to do without exposing provider details", async () => {
  const cases: [AuthResult, RegExp][] = [
    [async () => ({ error: { code: "over_email_send_rate_limit", message: "secret" } }), /Patientez une minute/],
    [async () => ({ error: { code: "over_request_rate_limit", message: "secret" } }), /Patientez une minute/],
    [async () => ({ error: { code: "unexpected_failure", message: "secret" } }), /Réessayez dans un instant/],
    [async () => { throw new Error("secret network detail"); }, /connexion internet/],
  ];
  for (const [result, expected] of cases) {
    await assert.rejects(requestPasswordReset(resetAuth(result).auth, "member@example.test", CALLBACK), rejectsWithout(/secret/, expected));
  }
});

test("a new password is saved, then the member's other devices are signed out", async () => {
  const { auth, calls } = passwordAuth(succeeds);
  assert.deepEqual(await updatePassword(auth, NEW_PASSWORD, NEW_PASSWORD), { otherDevicesSignedOut: true });
  assert.deepEqual(calls, [["updateUser", { password: NEW_PASSWORD }], ["signOut", { scope: "others" }]]);
});

test("the new password stays saved when the other devices cannot be signed out", async () => {
  const failures: AuthResult[] = [async () => ({ error: { code: "unexpected_failure" } }), async () => { throw new Error("offline"); }];
  for (const signOut of failures) {
    assert.deepEqual(await updatePassword(passwordAuth(succeeds, signOut).auth, NEW_PASSWORD, NEW_PASSWORD), { otherDevicesSignedOut: false });
  }
});

test("a password of exactly eight characters is the shortest one accepted", async () => {
  const { auth, calls } = passwordAuth(succeeds);
  await assert.rejects(updatePassword(auth, "1234567", "1234567"), /au moins 8 caractères/);
  assert.equal(calls.length, 0);
  await updatePassword(auth, "12345678", "12345678");
  assert.deepEqual(calls[0], ["updateUser", { password: "12345678" }]);
});

test("a short or mistyped password is refused before contacting the server", async () => {
  const { auth, calls } = passwordAuth(succeeds);
  await assert.rejects(updatePassword(auth, "court", "court"), /au moins 8 caractères/);
  await assert.rejects(updatePassword(auth, NEW_PASSWORD, `${NEW_PASSWORD}!`), /pas identiques/);
  assert.equal(calls.length, 0);
});

test("password update failures explain the next step without provider details", async () => {
  const cases: [unknown, RegExp][] = [
    [{ code: "same_password", message: "secret" }, /différent de l’ancien/],
    [{ code: "weak_password", message: "secret" }, /trop facile à deviner/],
    [{ code: "session_not_found", message: "secret" }, /nouveau lien/],
    [{ code: "session_expired", message: "secret" }, /nouveau lien/],
    [{ code: "reauthentication_needed", message: "secret" }, /nouveau lien/],
    [{ code: "over_request_rate_limit", message: "secret" }, /Patientez/],
    [{ code: "unexpected_failure", message: "secret" }, /Réessayez dans un instant/],
  ];
  for (const [error, expected] of cases) {
    const { auth, calls } = passwordAuth(async () => ({ error }));
    await assert.rejects(updatePassword(auth, NEW_PASSWORD, NEW_PASSWORD), rejectsWithout(/secret/, expected));
    assert.equal(calls.some(([name]) => name === "signOut"), false);
  }
  const offline = passwordAuth(async () => { throw new Error("secret network detail"); });
  await assert.rejects(updatePassword(offline.auth, NEW_PASSWORD, NEW_PASSWORD), rejectsWithout(/secret/, /connexion internet/));
});

test("the forgot password page reuses the address typed on the sign-in page, and only a text one", () => {
  assert.equal(emailFromRouterState({ email: "member@example.test" }), "member@example.test");
  for (const state of [null, undefined, "member@example.test", {}, { email: 42 }, { address: "member@example.test" }]) {
    assert.equal(emailFromRouterState(state), "", JSON.stringify(state));
  }
});

test("the saved password message only promises a sign-out of other devices that happened", () => {
  assert.match(savedPasswordMessage({ otherDevicesSignedOut: true }), /autres appareils ont été déconnectés/);
  assert.doesNotMatch(savedPasswordMessage({ otherDevicesSignedOut: false }), /déconnectés/);
  assert.match(savedPasswordMessage({ otherDevicesSignedOut: false }), /prochaines connexions/);
});

test("only a return to the new password page counts as a password reset", () => {
  assert.equal(isPasswordResetReturn(NEW_PASSWORD_PATH), true);
  for (const next of [null, "/espace", FORGOT_PASSWORD_PATH, `${NEW_PASSWORD_PATH}-bis`, "https://evil.test/nouveau-mot-de-passe"]) {
    assert.equal(isPasswordResetReturn(next), false, String(next));
  }
});

test("an expired email link says so instead of reporting a refused sign-in", () => {
  const expired = new URL("https://site.test/auth/callback?next=%2Fnouveau-mot-de-passe#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.match(callbackError(expired) ?? "", /a expiré ou a déjà été utilisé/);
  assert.match(callbackError(new URL("https://site.test/auth/callback?error=access_denied&error_code=otp_expired")) ?? "", /a expiré/);
  assert.match(callbackError(new URL("https://site.test/auth/callback#error=access_denied")) ?? "", /annulée ou refusée/);
});
