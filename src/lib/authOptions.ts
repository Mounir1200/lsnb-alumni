// Both the public site and the hub must bind OAuth returns to this browser.
export const browserAuthOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  flowType: "pkce",
} as const;

// Email links may be opened on a different device. Verify their account in
// memory first; never publish this candidate through the shared auth client.
export const linkAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  flowType: "pkce",
  storageKey: "lsnb-link-confirmation",
} as const;

// Keep existing ConfirmationURL emails usable on another device. This client
// only issues signups; URL sessions are still never detected or persisted.
export const emailSignupAuthOptions = {
  ...linkAuthOptions,
  flowType: "implicit",
  storageKey: "lsnb-email-signup",
} as const;
