import type { AlumniProfile } from "../../data/alumni";
import { cn } from "../../lib/cn";

type AvatarProps = Pick<AlumniProfile, "initials" | "avatarTone" | "photoUrl"> & {
  className?: string;
  label?: string;
};

export function Avatar({ initials, avatarTone, photoUrl, className, label }: AvatarProps) {
  return (
    <span
      className={cn("avatar", `avatar--${avatarTone}`, className)}
      role="img"
      aria-label={label ?? `Portrait de démonstration ${initials}`}
    >
      {photoUrl ? <img src={photoUrl} alt="" /> : <span aria-hidden="true">{initials}</span>}
    </span>
  );
}
