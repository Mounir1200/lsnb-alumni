/** Where a member's photo lives in the public "avatars" bucket. */
export function avatarPath(userId: string) {
  return `${userId}/avatar`;
}
