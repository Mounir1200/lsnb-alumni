import { useEffect, useId, useRef, useState } from "react";
import { startGoogleSignIn } from "../../lib/googleAuth";

type GoogleAuthButtonProps = {
  next?: string | null;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

export function GoogleAuthButton({ next, disabled = false, onBusyChange }: GoogleAuthButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const errorId = useId();

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      pending.current = false;
      setBusy(false);
      setError(undefined);
      onBusyChange?.(false);
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [onBusyChange]);

  const handleSignIn = async () => {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    onBusyChange?.(true);

    try {
      await startGoogleSignIn(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La connexion avec Google est indisponible. Réessayez.");
      pending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="google-auth">
      <button
        type="button"
        className="google-auth__button"
        disabled={disabled || busy}
        aria-busy={busy}
        aria-describedby={error ? errorId : undefined}
        onClick={handleSignIn}
      >
        {/* Official Google Identity branding asset, preserved at its original aspect ratio. */}
        <img src="/images/google-g.png" width="20" height="20" alt="" aria-hidden="true" />
        <span>{busy ? "Ouverture de Google…" : "Continuer avec Google"}</span>
      </button>
      {error && <p id={errorId} className="form-status form-status--error" role="alert">{error}</p>}
    </div>
  );
}
