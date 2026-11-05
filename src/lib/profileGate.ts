const PROFILE_LINK = /^\/alumni\/([^/?#]+)\/?(?:[?#].*)?$/;

/** The member a site link points to, when it opens a profile page. */
export function profileIdFromHref(href: string | null | undefined): string | undefined {
  return href ? PROFILE_LINK.exec(href)?.[1] : undefined;
}
