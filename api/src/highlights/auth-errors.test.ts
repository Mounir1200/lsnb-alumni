import assert from "node:assert/strict";
import test from "node:test";
import { authFailure, isRateLimited, OFFLINE } from "../../../src/lib/authErrors.ts";
import { getLoginError } from "../../../src/lib/emailConfirmation.ts";
import { errorCode } from "../../../src/lib/errorCode.ts";

test("an error code is read from objects only, and is empty otherwise", () => {
  assert.equal(errorCode({ code: "invalid_credentials" }), "invalid_credentials");
  assert.equal(errorCode({ code: 42501 }), "42501");
  for (const error of [null, undefined, "invalid_credentials", 0, {}, new Error("invalid_credentials")]) {
    assert.equal(errorCode(error), "", String(error));
  }
});

test("only the two Supabase rate limits count as rate limiting", () => {
  assert.equal(isRateLimited({ code: "over_email_send_rate_limit" }), true);
  assert.equal(isRateLimited({ code: "over_request_rate_limit" }), true);
  for (const error of [{ code: "email_not_confirmed" }, null, "over_request_rate_limit"]) assert.equal(isRateLimited(error), false);
});

test("an Auth call is reported as succeeded, failed with its error, or offline", async () => {
  const failure = { code: "same_password" };
  assert.equal(await authFailure(async () => ({ error: null })), null);
  assert.equal(await authFailure(async () => ({ error: undefined })), null);
  assert.equal(await authFailure(async () => ({ error: failure })), failure);
  assert.equal(await authFailure(async () => { throw new Error("network down"); }), OFFLINE);
});

test("sign-in errors tell the member what went wrong in their words", () => {
  assert.match(getLoginError({ code: "invalid_credentials" }), /adresse e-mail ou le mot de passe est incorrect/);
  assert.match(getLoginError({ code: "over_request_rate_limit" }), /Patientez un peu/);
  assert.match(getLoginError({ code: "unexpected_failure" }), /Vérifiez votre connexion internet/);
  assert.doesNotMatch(getLoginError({ code: "unexpected_failure" }), /incorrect/);
});
