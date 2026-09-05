export const AUTH_CALLBACK_PATH = "/auth/callback";

export function getAuthCallbackUrl(next?: string | null) {
  const url = new URL(AUTH_CALLBACK_PATH, window.location.origin);
  if (next) url.searchParams.set("next", getSafeNextPath(next));
  return url.toString();
}

export function getSafeNextPath(value: string | null, fallback = "/espace") {
  if (!value || value.length > 2048) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (![value, decoded].every((path) => path.startsWith("/") && !path.startsWith("//")
      && !/[\\\u0000-\u001f\u007f]/.test(path))) return fallback;
    const url = new URL(value, "https://lsnb.invalid");
    if (url.origin !== "https://lsnb.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function getPostAuthPath(value: string | null) {
  const next = getSafeNextPath(value);
  const pathname = decodeURIComponent(new URL(next, "https://lsnb.invalid").pathname).toLowerCase().replace(/\/+$/, "");
  return ["/connexion", "/rejoindre", AUTH_CALLBACK_PATH, "/completer-profil"].includes(pathname)
    ? "/espace" : next;
}

export function getProfileCompletionPath(next: string | null) {
  return `/completer-profil?${new URLSearchParams({ next: getPostAuthPath(next) })}`;
}
