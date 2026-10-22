export type SiteStatus = {
  enabled: boolean;
  active: boolean;
  message: string;
  ends_at: string | null;
  started_at: string | null;
  server_time: string;
};

export function parseSiteStatus(value: unknown): SiteStatus {
  if (!value || typeof value !== "object")
    throw new Error("Invalid site status");
  const status = value as Partial<SiteStatus>;
  if (
    typeof status.enabled !== "boolean" ||
    typeof status.active !== "boolean" ||
    typeof status.message !== "string" ||
    typeof status.server_time !== "string" ||
    !Number.isFinite(Date.parse(status.server_time)) ||
    (status.ends_at !== null &&
      (typeof status.ends_at !== "string" ||
        !Number.isFinite(Date.parse(status.ends_at)))) ||
    (status.started_at !== null &&
      (typeof status.started_at !== "string" ||
        !Number.isFinite(Date.parse(status.started_at))))
  ) {
    throw new Error("Invalid site status");
  }
  return status as SiteStatus;
}

export function remainingTime(endsAt: string, now: number) {
  const total = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor(total / 3600) % 24,
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
    total,
  };
}

// Never record profile IDs, offer IDs, searches, URL parameters or messages.
export function activityRoute(
  path: string,
):
  "home" | "directory" | "profile" | "offers" | "highlights" | "member" | null {
  if (path === "/") return "home";
  if (path === "/annuaire") return "directory";
  if (path.startsWith("/alumni/")) return "profile";
  if (path === "/offres" || path.startsWith("/offres/")) return "offers";
  if (path === "/highlights") return "highlights";
  if (path === "/espace" || path.startsWith("/espace/")) return "member";
  return null;
}
