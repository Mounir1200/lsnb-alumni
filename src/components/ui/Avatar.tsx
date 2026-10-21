import { useEffect, useState } from "react";
import type { AlumniProfile } from "../../data/alumni";
import { cn } from "../../lib/cn";

type AvatarProps = Pick<AlumniProfile, "initials" | "avatarTone" | "photoUrl"> & {
  className?: string;
  label?: string;
  loading?: "lazy" | "eager";
};

export function Avatar({ initials, avatarTone, photoUrl, className, label, loading }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl]);

  return (
    <span
      className={cn("avatar", `avatar--${avatarTone}`, className)}
      role="img"
      aria-label={label ?? `Portrait de démonstration ${initials}`}
    >
      {photoUrl && !imageFailed ? (
        <img src={photoUrl} alt="" loading={loading} decoding="async" onError={() => setImageFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  );
}
