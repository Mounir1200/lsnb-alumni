import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";

type BrandMarkProps = {
  className?: string;
  compact?: boolean;
  variant?: "horizontal" | "stacked";
};

export function BrandMark({
  className,
  compact = false,
  variant = "horizontal",
}: BrandMarkProps) {
  return (
    <Link
      to="/"
      className={cn(
        "brand-mark",
        `brand-mark--${variant}`,
        compact && "brand-mark--compact",
        className,
      )}
      aria-label="Alumni LSNB — Accueil"
    >
      {variant === "stacked" ? (
        <img
          src="/images/brand/alumni-lsnb-logo-green.png"
          className="brand-mark__image"
          width="640"
          height="480"
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable="false"
        />
      ) : (
        <>
          <img
            src="/images/brand/alumni-lsnb-emblem.png"
            className="brand-mark__emblem"
            width="512"
            height="512"
            alt=""
            aria-hidden="true"
            decoding="async"
            fetchPriority="high"
            draggable="false"
          />
          <span className="brand-mark__wordmark" aria-hidden="true">
            <span>ALUMNI</span>
            <span className="brand-mark__wordmark-accent">LSNB</span>
          </span>
        </>
      )}
    </Link>
  );
}
