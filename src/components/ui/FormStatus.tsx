import { AlertCircle, Check, LoaderCircle } from "lucide-react";

export type FormStatusValue = { kind: "idle" | "loading" | "success" | "error"; message?: string };

const ICONS = {
  idle: LoaderCircle,
  loading: LoaderCircle,
  success: Check,
  error: AlertCircle,
};

/** A form's outcome: errors are announced at once, the other messages politely. */
export function FormStatus({ status }: { status: FormStatusValue }) {
  if (!status.message) return null;
  const Icon = ICONS[status.kind];
  return (
    <div className={`form-status form-status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
      <Icon className={status.kind === "loading" ? "spin" : undefined} aria-hidden="true" />
      {status.message}
    </div>
  );
}
