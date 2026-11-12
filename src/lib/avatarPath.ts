/** Where a member's photo lives in the public "avatars" bucket: the only name its storage rules accept (private.is_own_avatar). */
export function avatarPath(userId: string) {
  return `${userId}/avatar`;
}
