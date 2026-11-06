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
  const withPhoto = profiles.filter((profile) => Boolean(profile.photoUrl));
  // Fisher-Yates: every order is equally likely.
  for (let index = withPhoto.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [withPhoto[index], withPhoto[other]] = [withPhoto[other]!, withPhoto[index]!];
  }
  const portraits = withPhoto.slice(0, DIRECTORY_PORTRAIT_SLOTS).map((profile) => ({ kind: "portrait" as const, profile }));
  const placeholders = Array.from({ length: DIRECTORY_PORTRAIT_SLOTS - portraits.length }, () => ({ kind: "placeholder" as const }));
  return [...portraits, ...placeholders];
}
