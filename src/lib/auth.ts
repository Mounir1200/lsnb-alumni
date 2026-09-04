export const AUTH_CALLBACK_PATH = "/auth/callback";

export function getAuthCallbackUrl() {
  return new URL(AUTH_CALLBACK_PATH, window.location.origin).toString();
}

export function getSafeNextPath(value: string | null, fallback = "/espace") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
