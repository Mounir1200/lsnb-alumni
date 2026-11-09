import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import "./ModalDialog.css";

type ModalDialogProps = { open: boolean; onClose: () => void; titleId: string; children: ReactNode };

/**
 * A native modal: focus stays inside, and Escape, the backdrop or the close button
 * dismisses it. Its content stays mounted while closed, so a draft survives a stray click.
 */
export function ModalDialog({ open, onClose, titleId, children }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
    >
      <div className="modal-dialog__panel">
        <button type="button" className="modal-dialog__close" aria-label="Fermer" onClick={() => dialogRef.current?.close()}>
          <X size={20} aria-hidden="true" />
        </button>
        {children}
      </div>
    </dialog>
  );
}
