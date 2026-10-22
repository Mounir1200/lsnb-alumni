import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { SiteStatus } from "../../lib/siteAvailability";
import { CounterLoader } from "./CounterLoader";
import "./Maintenance.css";

export function MaintenancePage({
  status,
  clockOffset,
  onRetry,
  checking,
  error,
  preview = false,
}: {
  status: SiteStatus;
  clockOffset: number;
  onRetry: () => void;
  checking: boolean;
  error?: boolean;
  preview?: boolean;
}) {
  const hubUrl = import.meta.env.VITE_HUB_URL;
  return (
    <div className="maintenance-page">
      <header className="maintenance-header">
        <span className="maintenance-brand">
          <img src="/images/brand/site-icon-512.png" alt="" />
          LSNB <b>Réseau</b>
        </span>
        <span className="maintenance-state">
          <i />
          {preview ? "Aperçu local" : "Maintenance en cours"}
        </span>
      </header>
      <main className="maintenance-main">
        <p className="maintenance-kicker">On prend soin du réseau.</p>
        <h1>
          Une courte pause.
          <br />
          <span>Les liens restent.</span>
        </h1>
        <p className="maintenance-message">
          {status.message ||
            "Nous préparons les prochaines améliorations de votre réseau. Merci de votre patience."}
        </p>
        {status.ends_at ? (
          <>
            <p className="maintenance-count-label">Réouverture prévue dans</p>
            <CounterLoader endsAt={status.ends_at} clockOffset={clockOffset} />
            <p className="maintenance-date">
              {new Date(status.ends_at).toLocaleString("fr-FR", {
                dateStyle: "long",
                timeStyle: "short",
              })}{" "}
              · heure de votre appareil
            </p>
          </>
        ) : (
          <div className="maintenance-indefinite">
            <span className="maintenance-orbit" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <p>
              Retour prochainement
              <small>L’équipe rouvrira le réseau dès que tout sera prêt.</small>
            </p>
          </div>
        )}
        <div className="maintenance-actions">
          <button onClick={onRetry} disabled={checking || preview}>
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={checking ? "is-checking" : ""}
            />
            {checking ? "Vérification…" : "Vérifier la disponibilité"}
          </button>
          <p aria-live="polite">
            {error
              ? "La connexion est interrompue. Nouvelle vérification automatique dans quelques instants."
              : "Cette page se met à jour automatiquement."}
          </p>
        </div>
      </main>
      <footer className="maintenance-footer">
        <span>De Bobo-Dioulasso au reste du monde.</span>
        {hubUrl && (
          <a href={hubUrl}>
            Accès à l’équipe <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        )}
        <span>LSNB · Alumni de Sya</span>
      </footer>
    </div>
  );
}
