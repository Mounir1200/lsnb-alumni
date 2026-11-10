import { Flag, MessagesSquare, UserMinus } from "lucide-react";
import { useState } from "react";
import { REPORT_REASONS } from "../lib/safety";
import { type Context, type HubReport, type PageData, type ReportMessage, date, rpc, useResource } from "./api";
import { Confirm, Empty, ErrorState, Loading, Pagination, Refresh, Status } from "./ui";

type Decision = { report: HubReport; action: "resolved" | "dismissed" | "suspend" };
type ReportView = "open" | "handled";

const reasonLabels: Record<string, string> = Object.fromEntries(REPORT_REASONS.map((reason) => [reason.value, reason.label]));
const views: { id: ReportView; label: string }[] = [{ id: "open", label: "À traiter" }, { id: "handled", label: "Traités" }];

function Person({ person }: { person: { name: string; graduation_year: number | null } | null }) {
  if (!person) return <>Compte supprimé</>;
  return <>{person.name}{person.graduation_year && <small> · Promotion {person.graduation_year}</small>}</>;
}

/** Reported messages stay folded: the team opens them when the report calls for it. */
function ReportedConversation({ messages }: { messages: ReportMessage[] }) {
  return (
    <details className="hub-report-conversation">
      <summary><MessagesSquare size={15} aria-hidden="true" /> Conversation signalée · {messages.length} message{messages.length > 1 ? "s" : ""}</summary>
      <ol>
        {messages.map((message, index) => (
          <li key={index} className={message.from === "reported" ? "is-reported" : undefined}>
            <span>{message.from === "reported" ? "Membre signalé" : "Auteur du signalement"} · {date(message.sent_at, true)}</span>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ReportOutcome({ report }: { report: HubReport }) {
  return (
    <p className="hub-report-outcome">
      <Status active={report.status === "resolved"}>{report.status === "resolved" ? "Résolu" : "Classé sans suite"}</Status>
      <span>{report.resolution}</span>
      <small>{report.handled_by_name || "Compte supprimé"}{report.handled_at && ` · ${date(report.handled_at, true)}`}</small>
    </p>
  );
}

function ReportCard({ report, onDecide }: { report: HubReport; onDecide: (decision: Decision) => void }) {
  const canSuspend = report.status === "open" && report.reported && !report.reported.is_suspended;
  return (
    <article className="hub-report" aria-label={`Signalement : ${reasonLabels[report.reason] ?? report.reason}`}>
      <header>
        <span className="hub-report-reason"><Flag size={14} aria-hidden="true" /> {reasonLabels[report.reason] ?? report.reason}</span>
        <time dateTime={report.created_at}>{date(report.created_at, true)}</time>
      </header>
      <dl>
        <div>
          <dt>Membre signalé</dt>
          <dd><Person person={report.reported} /> {report.reported?.is_suspended && <Status active={false}>Accès retiré</Status>}</dd>
        </div>
        <div><dt>Signalé par</dt><dd><Person person={report.reporter} /></dd></div>
      </dl>
      {report.details && <blockquote>{report.details}</blockquote>}
      {report.messages && report.messages.length > 0 && <ReportedConversation messages={report.messages} />}
      {report.status === "open" ? (
        <div className="hub-report-actions">
          <button className="hub-button primary" onClick={() => onDecide({ report, action: "resolved" })}>Marquer résolu</button>
          <button className="hub-button" onClick={() => onDecide({ report, action: "dismissed" })}>Classer sans suite</button>
          {canSuspend && (
            <button className="hub-button danger" onClick={() => onDecide({ report, action: "suspend" })}>
              <UserMinus size={15} aria-hidden="true" /> Retirer l’accès
            </button>
          )}
        </div>
      ) : <ReportOutcome report={report} />}
    </article>
  );
}

function DecisionDialog({ decision, onClose, onDone }: { decision: Decision; onClose: () => void; onDone: () => void }) {
  const { report, action } = decision;
  if (action === "suspend") {
    return (
      <Confirm
        title={`Retirer l’accès de ${report.reported?.name ?? "ce membre"} ?`}
        label="Retirer l’accès"
        danger
        requireReason
        reasonPlaceholder="Ex. Demande d’argent à un élève, signalée avec la conversation."
        onClose={onClose}
        onConfirm={async (reason) => {
          await rpc("hub_moderate_member", { p_member_id: report.reported?.id, p_active: false, p_reason: reason });
          onDone();
        }}
      >
        Le membre perd l’accès au réseau et sa fiche disparaît de l’annuaire. Un administrateur peut rétablir
        l’accès. Marquez ensuite le signalement comme résolu.
      </Confirm>
    );
  }
  const resolved = action === "resolved";
  return (
    <Confirm
      title={resolved ? "Marquer ce signalement comme résolu ?" : "Classer ce signalement sans suite ?"}
      label={resolved ? "Marquer résolu" : "Classer sans suite"}
      requireReason
      reasonPlaceholder={resolved ? "Ex. Membre averti ; il a retiré son offre." : "Ex. Malentendu entre les deux membres, aucun manquement."}
      onClose={onClose}
      onConfirm={async (reason) => {
        await rpc("hub_resolve_report", { p_report_id: report.id, p_status: action, p_resolution: reason });
        onDone();
      }}
    >
      La note est conservée dans le journal de modération. Le membre signalé n’est pas prévenu de cette décision.
    </Confirm>
  );
}

export function Reports({ context, revision }: { context: Context; revision: number }) {
  const [view, setView] = useState<ReportView>("open");
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [changes, setChanges] = useState(0);
  const resource = useResource(
    () => rpc<PageData<HubReport>>("hub_reports", { p_status: view, p_page: page }),
    `reports-${view}-${page}-${revision}-${changes}`,
  );

  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>Ce que les membres signalent.</h1>
          <p>
            {context.role === "admin"
              ? "Les signalements de tout le réseau."
              : `Les signalements qui visent la promotion ${context.graduation_year}. Ceux qui visent un membre de l’équipe vont aux administrateurs.`}
          </p>
        </div>
        <Refresh onClick={resource.refresh} loading={resource.loading} at={resource.at} />
      </div>
      <section className="hub-panel">
        <div className="hub-panel-head">
          <div>
            <h2>{view === "open" ? "À traiter" : "Traités"}</h2>
            <p>{resource.data ? `${resource.data.total} signalement${resource.data.total > 1 ? "s" : ""}` : "Chargement…"}</p>
          </div>
          <div className="hub-segment" aria-label="Signalements affichés">
            {views.map((item) => (
              <button key={item.id} aria-pressed={view === item.id} className={view === item.id ? "is-selected" : ""}
                onClick={() => { setView(item.id); setPage(1); }}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {resource.error && <ErrorState message={resource.error} retry={resource.refresh} />}
        {resource.loading && !resource.data && <Loading />}
        {resource.data && (resource.data.items.length ? (
          <div className="hub-report-list">
            {resource.data.items.map((report) => <ReportCard key={report.id} report={report} onDecide={setDecision} />)}
          </div>
        ) : (
          <Empty title={view === "open" ? "Aucun signalement à traiter" : "Aucun signalement traité"}>
            {view === "open" ? "Les nouveaux signalements des membres apparaîtront ici." : "Les décisions de l’équipe apparaîtront ici."}
          </Empty>
        ))}
        {resource.data && <Pagination page={page} total={resource.data.total} size={resource.data.page_size} onPage={setPage} />}
      </section>
      {decision && <DecisionDialog decision={decision} onClose={() => setDecision(null)} onDone={() => setChanges((value) => value + 1)} />}
    </>
  );
}
