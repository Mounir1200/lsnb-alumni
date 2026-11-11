/** What asking about the hub needs from Supabase. */
export type HubAccessClient = {
  rpc(name: "has_hub_access"): PromiseLike<{ data: unknown; error: unknown }>;
};

/** The database's answer about one account. */
export type HubAccess = { userId: string; isOpen: boolean };

/** The team's hub is a separate app at VITE_HUB_URL. Without it, the site links to no hub. */
export function teamHubUrl({ VITE_HUB_URL }: { VITE_HUB_URL?: string } = import.meta.env) {
  return VITE_HUB_URL?.trim() || null;
}

/**
 * Whether the hub opens to the signed-in member. The database answers for the
 * session's own account only, with the hub's own gate; any doubt hides the link.
 */
export async function loadHubAccess(client: HubAccessClient | null) {
  if (!client) return false;
  const { data, error } = await client.rpc("has_hub_access");
  return !error && data === true;
}

/**
 * The hub's address, when the answer concerns this very account and opens the
 * hub to it. An answer left over from another session never shows the link.
 */
export function hubLinkFor(userId: string, access: HubAccess | null, hubUrl: string | null) {
  return access?.userId === userId && access.isOpen ? hubUrl : null;
}
