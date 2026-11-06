/** The directory hero shows this many members around Bobo-Dioulasso. */
export const DIRECTORY_PORTRAIT_SLOTS = 4;

export type DirectoryPortraitSlot<T> = { kind: "portrait"; profile: T } | { kind: "placeholder" };

/**
 * Members with a profile photo, drawn at random for the directory hero. While
 * fewer than four have one, the remaining places show a placeholder, which the
 * next photo replaces.
 */
export function pickDirectoryPortraits<T extends { photoUrl?: string }>(
  profiles: T[],
  random: () => number = Math.random,
): DirectoryPortraitSlot<T>[] {
  // One random key per member, then sorted on it: every order is equally likely.
  const drawn = profiles
    .filter((profile) => Boolean(profile.photoUrl))
    .map((profile) => ({ profile, key: random() }))
    .sort((first, second) => first.key - second.key);
  const portraits = drawn.slice(0, DIRECTORY_PORTRAIT_SLOTS).map(({ profile }) => ({ kind: "portrait" as const, profile }));
  const placeholders = Array.from({ length: DIRECTORY_PORTRAIT_SLOTS - portraits.length }, () => ({ kind: "placeholder" as const }));
  return [...portraits, ...placeholders];
}
