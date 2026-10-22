import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { number } from "./api";

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="hub-error" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>Impossible de terminer cette opération</strong>
        <p>{message}</p>
        {retry && (
          <button className="hub-text-button" onClick={retry}>
            Réessayer <RefreshCw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
export function Loading({
  label = "Chargement des données…",
}: {
  label?: string;
}) {
  return (
    <div className="hub-empty" role="status">
      <LoaderCircle className="hub-spin" size={23} />
      <p>{label}</p>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="hub-empty">
      <span className="hub-empty-mark" aria-hidden="true">
        —
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Status({
  active,
  children,
}: {
  active: boolean;
  children?: ReactNode;
}) {
  return (
    <span className={`hub-status ${active ? "is-positive" : "is-warning"}`}>
      <i />
      {children || (active ? "Actif" : "Suspendu")}
    </span>
  );
}
export function Refresh({
  onClick,
  loading,
  at,
}: {
  onClick: () => void;
  loading: boolean;
  at?: Date | null;
}) {
  return (
    <div className="hub-refresh">
      {at && (
        <span>
          Actualisé à{" "}
          {at.toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
      <button
        className="hub-button subtle"
        disabled={loading}
        onClick={onClick}
      >
        <RefreshCw size={15} className={loading ? "hub-spin" : ""} />
        Actualiser
      </button>
    </div>
  );
}
export function Pagination({
  page,
  total,
  size,
  onPage,
}: {
  page: number;
  total: number;
  size: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="hub-pagination">
      <span>
        {total
          ? `${number((page - 1) * size + 1)}–${number(Math.min(page * size, total))} sur ${number(total)}`
          : "0 résultat"}
      </span>
      <div>
        <button
          className="hub-icon-button"
          aria-label="Page précédente"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft size={16} />
        </button>
        <span>Page {page}</span>
        <button
          className="hub-icon-button"
          aria-label="Page suivante"
          disabled={page * size >= total}
          onClick={() => onPage(page + 1)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function Confirm({
  title,
  children,
  label,
  danger,
  requireReason = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  label: string;
  danger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opération impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="hub-dialog"
      ref={ref}
      aria-labelledby="confirmation-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="hub-dialog-head">
        <span className="hub-eyebrow">Confirmation</span>
        <button
          className="hub-icon-button"
          aria-label="Fermer"
          onClick={onClose}
          disabled={busy}
        >
          <X size={19} />
        </button>
      </div>
      <h2 id="confirmation-title">{title}</h2>
      <div className="hub-dialog-copy">{children}</div>
      {requireReason && (
        <label className="hub-field">
          Motif de la décision
          <textarea
            autoFocus
            maxLength={500}
            minLength={10}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. Ce membre n’appartient pas à la promotion indiquée."
          />
          <small>
            De 10 à 500 caractères. Ce motif sera conservé dans le journal.
          </small>
        </label>
      )}
      {error && <ErrorState message={error} />}
      <div className="hub-dialog-actions">
        <button className="hub-button" disabled={busy} onClick={onClose}>
          Annuler
        </button>
        <button
          className={`hub-button ${danger ? "danger" : "primary"}`}
          disabled={busy || (requireReason && reason.trim().length < 10)}
          onClick={() => void confirm()}
        >
          {busy ? (
            <LoaderCircle className="hub-spin" size={16} />
          ) : (
            <Check size={16} />
          )}
          {busy ? "Enregistrement…" : label}
        </button>
      </div>
    </dialog>
  );
}
