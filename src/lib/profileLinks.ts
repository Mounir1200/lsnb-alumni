export type ProfileLinkKind = "linkedin" | "portfolio";

export const PROFILE_LINK_MAX_LENGTH = 2048;

// Keep these ranges aligned with is_public_profile_ip in the SQL migration.
// No DNS resolution is performed: this checks literal addresses and local names.
function isBlockedIpv4(address: number) {
  const first = address >>> 24;
  const second = (address >>> 16) & 255;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseCanonicalIpv6(hostname: string): bigint {
  // URL has already validated and canonicalized IPv6, including embedded IPv4.
  const address = hostname.slice(1, -1);
  const [left = "", right = ""] = address.split("::");
  const leading = left ? left.split(":") : [];
  const trailing = right ? right.split(":") : [];
  const groups = address.includes("::")
    ? [...leading, ...Array<string>(8 - leading.length - trailing.length).fill("0"), ...trailing]
    : leading;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isBlockedIpv6(address: bigint) {
  const prefix96 = address >> 32n;
  // IPv4-compatible, unspecified and loopback addresses.
  if (prefix96 === 0n) return true;
  // IPv4-mapped, translated and well-known NAT64: inspect the embedded IPv4.
  if (prefix96 === 0xffffn || prefix96 === 0xffff0000n || prefix96 === 0x0064ff9b0000000000000000n) {
    return isBlockedIpv4(Number(address & 0xffffffffn));
  }
  // 6to4 encodes its gateway IPv4 immediately after the 2002 prefix.
  if (address >> 112n === 0x2002n) {
    return isBlockedIpv4(Number((address >> 80n) & 0xffffffffn));
  }
  return address >> 121n === 0x7en // fc00::/7, unique-local
    || address >> 118n === 0x3fan // fe80::/10, link-local
    || address >> 118n === 0x3fbn // fec0::/10, deprecated site-local
    || address >> 120n === 0xffn // multicast
    || address >> 80n === 0x0064ff9b0001n // local-use NAT64 prefix
    || address >> 96n === 0x20010000n; // Teredo tunnel addresses
}

function isAllowedProfileHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) return !isBlockedIpv6(parseCanonicalIpv6(host));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const address = host.split(".").reduce((value, part) => value * 256 + Number(part), 0);
    return !isBlockedIpv4(address);
  }
  // Require a DNS-style name, not a machine name resolved by a local search suffix.
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) return false;
  const lastLabel = host.split(".").at(-1) ?? "";
  if (/^(?:\d+|0x[0-9a-f]*)$/i.test(lastLabel)) return false;
  return !["localhost", "localdomain", "local", "internal", "lan", "home", "corp", "home.arpa"].some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** Empty links are optional; only explicitly supplied addresses are validated. */
export function normalizeProfileLink(
  value: string | null | undefined,
  kind: ProfileLinkKind,
): string | null {
  const link = value?.trim() ?? "";
  if (!link) return null;

  const label = kind === "linkedin" ? "LinkedIn" : "du portfolio";
  if (link.length > PROFILE_LINK_MAX_LENGTH) {
    throw new Error(`Le lien ${label} doit contenir au maximum ${PROFILE_LINK_MAX_LENGTH} caractères.`);
  }

  let url: URL;
  try {
    if (!/^https:\/\/[^/?#]+/i.test(link) || /[\s\\\u0000-\u001f\u007f]/u.test(link)) throw new Error();
    url = new URL(link);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error();
  } catch {
    throw new Error(`Le lien ${label} doit être une adresse complète commençant par https://, sans identifiants ni espaces.`);
  }

  if (!isAllowedProfileHost(url.hostname)) {
    throw new Error(`Le lien ${label} ne peut pas utiliser localhost, un nom local ou une adresse IP privée ou réservée au réseau local.`);
  }

  if (kind === "linkedin" && (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*linkedin\.com$/i.test(url.hostname.replace(/\.$/, ""))
    || !/^\/in\/[^/]+\/?$/.test(url.pathname)
    || url.port !== ""
  )) {
    throw new Error("Le lien LinkedIn doit pointer vers votre profil, par exemple https://www.linkedin.com/in/votre-nom/.");
  }

  const normalized = url.href;
  if (normalized.length > PROFILE_LINK_MAX_LENGTH) {
    throw new Error(`Le lien ${label} doit contenir au maximum ${PROFILE_LINK_MAX_LENGTH} caractères.`);
  }
  return normalized;
}

/** Keep malformed stored data from becoming a clickable link. */
export function getSafeProfileLink(value: string | null | undefined, kind: ProfileLinkKind) {
  try {
    return normalizeProfileLink(value, kind) ?? undefined;
  } catch {
    return undefined;
  }
}
