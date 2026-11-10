import { errorCode } from "./errorCode";

const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"]);

export function isRateLimited(error: unknown) {
  return RATE_LIMIT_CODES.has(errorCode(error));
}

/** A call that never reached Supabase: the member should check their connection. */
export const OFFLINE = Symbol("offline");

/** Runs a Supabase Auth call and returns its error, null on success, or OFFLINE when it threw. */
export async function authFailure(call: () => Promise<{ error: unknown }>): Promise<unknown> {
  try {
    return (await call()).error ?? null;
  } catch {
    return OFFLINE;
  }
}
