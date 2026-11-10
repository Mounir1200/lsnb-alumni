import { BadgeCheck, UserMinus, UserRoundPlus } from "lucide-react";
import { useState } from "react";
import { type Context, type Member, type PageData, date, fullName, roleName, rpc, useResource } from "./api";
import { Confirm, Empty, ErrorState, Loading, Pagination, Refresh } from "./ui";

type Decision = { member: Member; action: "approve" | "refuse" };

const place = (member: Member) => [member.city, member.country].filter(Boolean).join(", ") || "Non renseignée";

function ApprovalCard({ member, onDecide }: { member: Member; onDecide: (decision: Decision) => void }) {
  return (
    <article className="hub-report hub-approval" aria-label={`Compte à valider : ${fullName(member)}`}>
      <header>
        <span className="hub-report-reason"><UserRoundPlus size={14} aria-hidden="true" /> {fullName(member)}</span>
        <time dateTime={member.created_at}>Inscription le {date(member.created_at, true)}</time>
      </header>
      <dl>
        <div><dt>Promotion</dt><dd>{member.graduation_year ?? "Non renseignée"}</dd></div>
        <div><dt>Profil</dt><dd>{roleName(member.member_role)}{member.specialty ? ` · ${member.specialty}` : ""}</dd></div>
        <div><dt>Ville</dt><dd>{place(member)}</dd></div>
      </dl>
      <div className="hub-report-actions">
        <button className="hub-button primary" onClick={() => onDecide({ member, action: "approve" })}>
          <BadgeCheck size={15} aria-hidden="true" /> Valider le compte
        </button>
        <button className="hub-button danger" onClick={() => onDecide({ member, action: "refuse" })}>
          <UserMinus size={15} aria-hidden="true" /> Refuser
        </button>
      </div>
    </article>
  );
}

function DecisionDialog({ decision, onClose, onDone }: { decision: Decision; onClose: () => void; onDone: (message: string) => void }) {
  const name = fullName(decision.member);
  if (decision.action === "refuse") {
    return (
      <Confirm
        title={`Refuser le compte de ${name} ?`}
        label="Refuser le compte"
        danger
        requireReason
        reasonPlaceholder="Ex. Inconnu de la promotion après vérification auprès des délégués."
        onClose={onClose}
        onConfirm={async (reason) => {
          await rpc("hub_moderate_member", { p_member_id: decision.member.id, p_active: false, p_reason: reason });
          onDone(`${name} : compte refusé.`);
        }}
      >
        Cette personne ne pourra plus utiliser son compte. Le motif reste dans le journal de modération, et un
        administrateur peut revenir sur ce refus.
      </Confirm>
    );
  }
  return (
    <Confirm
      title={`Valider le compte de ${name} ?`}
      label="Valider le compte"
      onClose={onClose}
      onConfirm={async () => {
        await rpc("hub_approve_member", { p_member_id: decision.member.id });
        onDone(`${name} : compte validé.`);
      }}
    >
      Vérifiez que cette personne a bien fréquenté le lycée. Une fois validée, elle apparaît dans l’annuaire et peut
      écrire aux membres.
    </Confirm>
  );
}

/** New accounts stay invisible until the moderator of their promotion, or an administrator, approves them. */
export function Approvals({ context, revision }: { context: Context; revision: number }) {
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [changes, setChanges] = useState(0);
  const [success, setSuccess] = useState("");
  const resource = useResource(
    () => rpc<PageData<Member>>("hub_members", { p_search: "", p_promotion: null, p_status: "pending", p_page: page }),
    `approvals-${page}-${revision}-${changes}`,
  );
  const total = resource.data?.total ?? 0;

  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>Les nouveaux comptes à valider.</h1>
          <p>
            {context.role === "admin"
              ? "Toutes les promotions. Un compte reste invisible tant que personne ne l’a validé."
              : `Les inscriptions de la promotion ${context.graduation_year}. Un compte reste invisible tant que personne ne l’a validé.`}
          </p>
        </div>
        <Refresh onClick={resource.refresh} loading={resource.loading} at={resource.at} />
      </div>
      {success && <p className="hub-success" role="status">{success}</p>}
      <section className="hub-panel">
        <div className="hub-panel-head">
          <div>
            <h2>En attente</h2>
            <p>{resource.data ? `${total} compte${total > 1 ? "s" : ""}` : "Chargement…"}</p>
          </div>
        </div>
        {resource.error && <ErrorState message={resource.error} retry={resource.refresh} />}
        {resource.loading && !resource.data && <Loading />}
        {resource.data && (resource.data.items.length ? (
          <div className="hub-report-list">
            {resource.data.items.map((member) => <ApprovalCard key={member.id} member={member} onDecide={setDecision} />)}
          </div>
        ) : (
          <Empty title="Aucun compte en attente">Les nouvelles inscriptions apparaîtront ici.</Empty>
        ))}
        {resource.data && <Pagination page={page} total={total} size={resource.data.page_size} onPage={setPage} />}
      </section>
      {decision && (
        <DecisionDialog
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={(message) => { setSuccess(message); setChanges((value) => value + 1); }}
        />
      )}
    </>
  );
}
