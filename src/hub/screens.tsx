import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  Eye,
  Search,
  ShieldCheck,
  Terminal,
  UserMinus,
  UserPlus,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Audit,
  type Context,
  type Dashboard,
  type LogData,
  type Member,
  type PageData,
  type SiteStatus,
  type Staff,
  date,
  demoRole,
  fullName,
  number,
  roleName,
  rpc,
  useResource,
} from "./api";
import {
  Confirm,
  Empty,
  ErrorState,
  Loading,
  Pagination,
  Refresh,
  Status,
} from "./ui";

type Common = { context: Context; revision: number };
const actionNames: Record<string, string> = {
  member_suspended: "Membre suspendu",
  member_restored: "Membre rétabli",
  maintenance_enabled: "Maintenance activée",
  maintenance_disabled: "Site remis en ligne",
  maintenance_updated: "Maintenance modifiée",
  staff_updated: "Droits mis à jour",
  staff_granted: "Rôle attribué",
  staff_revoked: "Rôle retiré",
  promotion_changed: "Promotion corrigée",
  member_promotion_changed: "Promotion corrigée",
  promotion_corrected: "Promotion corrigée",
  staff_changed: "Droits mis à jour",
};

export function Overview({
  context,
  revision,
  goMembers,
}: Common & { goMembers: (year?: number) => void }) {
  const resource = useResource(
    () => rpc<Dashboard>("hub_dashboard"),
    `dashboard-${revision}`,
  );
  const [metric, setMetric] = useState<
    "active_members" | "views" | "registrations"
  >("active_members");
  const data = resource.data;
  const days = data?.activity || [];
  const max = Math.max(1, ...days.map((d) => d[metric]));
  const total = days.reduce((sum, d) => sum + d[metric], 0);
  const metricName = {
    active_members: "Membres actifs",
    views: "Pages vues",
    registrations: "Inscriptions",
  }[metric];
  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>Le réseau, en perspective.</h1>
          <p>
            {context.role === "admin"
              ? "L’activité des alumni et la vie de chaque promotion."
              : `Votre espace de modération pour la promotion ${context.graduation_year}.`}
          </p>
        </div>
        <Refresh
          onClick={resource.refresh}
          loading={resource.loading}
          at={resource.at}
        />
      </div>
      {resource.error && (
        <ErrorState message={resource.error} retry={resource.refresh} />
      )}
      {resource.loading && !resource.data && <Loading />}
      {data && (
        <>
          <div className="hub-kpis">
            <div className="hub-kpi dominant">
              <span>Membres du réseau</span>
              <strong>{number(data.members)}</strong>
              <small>
                {context.role === "admin"
                  ? "Toutes les promotions"
                  : `Promotion ${context.graduation_year}`}
              </small>
            </div>
            <div className="hub-kpi">
              <span>Actifs sur 30 jours</span>
              <strong>{number(data.active_30d)}</strong>
              <small>Membres distincts connectés</small>
            </div>
            <div className="hub-kpi">
              <span>Mentors</span>
              <strong>{number(data.mentors)}</strong>
              <small>Accompagner la prochaine génération</small>
            </div>
            <div className="hub-kpi">
              <span>Comptes suspendus</span>
              <strong>{number(data.suspended_members)}</strong>
              <button className="hub-text-button" onClick={() => goMembers()}>
                Consulter les membres <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
          <section className="hub-panel hub-activity">
            <div className="hub-panel-head">
              <div>
                <h2>L’activité du réseau</h2>
                <p>30 derniers jours · activité authentifiée · UTC</p>
              </div>
              <div className="hub-segment" aria-label="Indicateur du graphique">
                {(["active_members", "views", "registrations"] as const).map(
                  (key) => (
                    <button
                      key={key}
                      aria-pressed={metric === key}
                      className={metric === key ? "is-selected" : ""}
                      onClick={() => setMetric(key)}
                    >
                      {key === "active_members"
                        ? "Membres actifs"
                        : key === "views"
                          ? "Pages vues"
                          : "Inscriptions"}
                    </button>
                  ),
                )}
              </div>
            </div>
            {days.length ? (
              <>
                <div className="hub-chart-summary">
                  <strong>
                    {number(
                      metric === "active_members" ? data.active_30d : total,
                    )}
                  </strong>
                  <span>
                    {metric === "active_members"
                      ? "membres distincts sur la période"
                      : `${metricName.toLowerCase()} sur la période`}
                  </span>
                  <span className="hub-chart-key">
                    <i />
                    {metricName}
                  </span>
                </div>
                <div
                  className="hub-chart"
                  role="img"
                  aria-label={`${metricName} par jour, du ${date(days[0]!.day)} au ${date(days[days.length - 1]!.day)}. Données détaillées disponibles sous le graphique.`}
                >
                  <div className="hub-chart-scale">
                    <span>{number(max)}</span>
                    <span>{number(Math.round(max / 2))}</span>
                    <span>0</span>
                  </div>
                  <div className="hub-bars">
                    {days.map((d) => (
                      <div className="hub-bar-slot" key={d.day}>
                        <div
                          className="hub-bar"
                          style={{
                            height: `${d[metric] > 0 ? Math.max(1, (d[metric] / max) * 100) : 0}%`,
                          }}
                        >
                          <span>
                            {date(d.day)}
                            <b>{number(d[metric])}</b>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hub-chart-dates">
                  <span>{date(days[0]!.day)}</span>
                  <span>{date(days[Math.floor(days.length / 2)]!.day)}</span>
                  <span>{date(days[days.length - 1]!.day)}</span>
                </div>
                <p className="hub-chart-method">
                  Les vues sont indicatives : au maximum une vue par minute, par
                  membre et par rubrique.
                </p>
                <details className="hub-chart-details">
                  <summary>Voir les données du graphique</summary>
                  <div className="hub-table-scroll">
                    <table>
                      <caption className="hub-sr-only">
                        Activité quotidienne
                      </caption>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Membres actifs</th>
                          <th>Pages vues</th>
                          <th>Inscriptions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {days.map((d) => (
                          <tr key={d.day}>
                            <th scope="row">{date(d.day)}</th>
                            <td>{number(d.active_members)}</td>
                            <td>{number(d.views)}</td>
                            <td>{number(d.registrations)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <Empty title="Les premiers relevés arrivent bientôt">
                Les visites authentifiées alimenteront ce graphique au fil de
                l’utilisation du site.
              </Empty>
            )}
          </section>
          <div className="hub-overview-bottom">
            <section className="hub-panel">
              <div className="hub-panel-head">
                <div>
                  <h2>Les promotions</h2>
                  <p>Des parcours différents, un même réseau.</p>
                </div>
                <span className="hub-count">{data.promotions.length}</span>
              </div>
              {data.promotions.length ? (
                <div className="hub-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Promotion</th>
                        <th>Membres</th>
                        <th>Comptes actifs</th>
                        <th>
                          <span className="hub-sr-only">Voir la promotion</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.promotions.map((p) => (
                        <tr key={p.year}>
                          <th scope="row">
                            <span className="hub-promo-year">{p.year}</span>
                          </th>
                          <td>{number(p.members)}</td>
                          <td>
                            <span className="hub-inline-meter">
                              <span
                                style={{
                                  width: `${p.members ? (p.active / p.members) * 100 : 0}%`,
                                }}
                              />
                            </span>
                            <span>{number(p.active)}</span>
                          </td>
                          <td>
                            <button
                              className="hub-icon-button"
                              aria-label={`Voir les membres de la promotion ${p.year}`}
                              onClick={() => goMembers(p.year)}
                            >
                              <ArrowUpRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Aucune promotion pour le moment" />
              )}
            </section>
            <aside className="hub-network-note">
              <span className="hub-eyebrow">La vie du réseau</span>
              <h2>Les liens se cultivent.</h2>
              <p>
                Votre présence aide à garder un réseau utile, accueillant et
                fidèle à ses promotions.
              </p>
              <dl>
                <div>
                  <dt>Offres publiées</dt>
                  <dd>{number(data.offers)}</dd>
                </div>
                <div>
                  <dt>Demandes d’échange</dt>
                  <dd>{number(data.requests)}</dd>
                </div>
                <div>
                  <dt>Comptes actifs</dt>
                  <dd>{number(data.active_members)}</dd>
                </div>
              </dl>
              <span className="hub-note-foot">
                Lycée Scientifique National de Bobo-Dioulasso
              </span>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

export function Members({
  context,
  revision,
  initialPromotion,
}: Common & { initialPromotion?: number }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [promotion, setPromotion] = useState(
    initialPromotion ? String(initialPromotion) : "",
  );
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Member | null>(null);
  const [success, setSuccess] = useState("");
  const [correction, setCorrection] = useState<Member | null>(null);
  const [correctedYear, setCorrectedYear] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const effectivePromo =
    context.role === "moderator"
      ? context.graduation_year
      : promotion
        ? Number(promotion)
        : null;
  const resource = useResource(
    () =>
      rpc<PageData<Member>>("hub_members", {
        p_search: query,
        p_promotion: effectivePromo,
        p_status: status,
        p_page: page,
      }),
    `members-${query}-${effectivePromo}-${status}-${page}-${revision}`,
  );
  const promotions = useResource(
    () => rpc<Dashboard>("hub_dashboard"),
    `member-promotions-${revision}`,
  );
  async function moderate(reason: string) {
    if (!selected) return;
    await rpc("hub_moderate_member", {
      p_member_id: selected.id,
      p_active: selected.is_suspended,
      p_reason: reason,
    });
    setSuccess(
      `${fullName(selected)} : compte ${selected.is_suspended ? "rétabli" : "suspendu"}.`,
    );
    resource.refresh();
  }
  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>Les membres.</h1>
          <p>
            {context.role === "admin"
              ? "Retrouvez les alumni et veillez à la qualité du réseau."
              : `Vous modérez les membres rattachés à la promotion ${context.graduation_year}.`}
          </p>
        </div>
        <Refresh
          onClick={resource.refresh}
          loading={resource.loading}
          at={resource.at}
        />
      </div>
      {success && (
        <p className="hub-success" role="status">
          {success}
        </p>
      )}
      <div className="hub-notice">
        <ShieldCheck size={18} />
        <p>
          Retirer un membre suspend son accès au réseau. Son profil est conservé
          et un administrateur peut le rétablir.
        </p>
      </div>
      <section className="hub-panel">
        <div className="hub-filters">
          <label className="hub-search">
            <Search size={17} />
            <span className="hub-sr-only">Rechercher un membre</span>
            <input
              placeholder="Rechercher un nom…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {context.role === "admin" && (
            <label className="hub-select-label">
              <span className="hub-sr-only">Promotion</span>
              <select
                value={promotion}
                onChange={(e) => {
                  setPromotion(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Toutes les promotions</option>
                {promotions.data?.promotions.map((p) => (
                  <option key={p.year} value={p.year}>
                    Promotion {p.year}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="hub-select-label">
            <span className="hub-sr-only">État du compte</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Comptes actifs</option>
              <option value="suspended">Comptes suspendus</option>
            </select>
          </label>
        </div>
        {resource.error && (
          <ErrorState message={resource.error} retry={resource.refresh} />
        )}
        {resource.loading && !resource.data && <Loading />}
        {resource.data && (
          <>
            {resource.data.items.length ? (
              <div className="hub-table-scroll">
                <table className="hub-member-table">
                  <thead>
                    <tr>
                      <th>Membre</th>
                      <th>Promotion</th>
                      <th>Localisation</th>
                      <th>Statut</th>
                      <th>Inscription</th>
                      <th>Modération</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.items.map((m) => (
                      <tr key={m.id}>
                        <th scope="row">
                          <div className="hub-person">
                            <span className="hub-avatar" aria-hidden="true">
                              {m.first_name?.charAt(0)}
                              {m.last_name?.charAt(0)}
                            </span>
                            <span>
                              {fullName(m)}
                              <small>
                                {roleName(m.staff_role || m.member_role)}
                              </small>
                            </span>
                          </div>
                        </th>
                        <td>
                          <span className="hub-promo-year">
                            {m.graduation_year || "—"}
                          </span>
                        </td>
                        <td>
                          <span>
                            {m.city || "Non renseignée"}
                            <small className="hub-cell-sub">
                              {m.country || ""}
                            </small>
                          </span>
                        </td>
                        <td>
                          <Status active={!m.is_suspended}>
                            {m.is_suspended
                              ? "Suspendu"
                              : m.profile_completed
                                ? "Actif"
                                : "À compléter"}
                          </Status>
                        </td>
                        <td>{date(m.created_at)}</td>
                        <td>
                          <div className="hub-member-actions">
                            {context.role === "admin" &&
                              m.staff_role !== "moderator" && (
                                <button
                                  className="hub-row-button positive"
                                  onClick={() => {
                                    setCorrection(m);
                                    setCorrectedYear(
                                      m.graduation_year
                                        ? String(m.graduation_year)
                                        : "",
                                    );
                                  }}
                                >
                                  Corriger la promotion
                                </button>
                              )}
                            {m.id === context.user_id || m.staff_role ? (
                              <span className="hub-muted">Compte protégé</span>
                            ) : !m.is_suspended ? (
                              <button
                                className="hub-row-button"
                                onClick={() => setSelected(m)}
                              >
                                <UserMinus size={15} />
                                Retirer
                              </button>
                            ) : context.role === "admin" ? (
                              <button
                                className="hub-row-button positive"
                                onClick={() => setSelected(m)}
                              >
                                <UserPlus size={15} />
                                Rétablir
                              </button>
                            ) : (
                              <span className="hub-muted">Admin requis</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Aucun membre trouvé">
                Essayez un autre nom ou ajustez les filtres.
              </Empty>
            )}
            <Pagination
              page={page}
              total={resource.data.total}
              size={resource.data.page_size}
              onPage={setPage}
            />
          </>
        )}
      </section>
      {selected && (
        <Confirm
          title={`${selected.is_suspended ? "Rétablir" : "Retirer"} ${fullName(selected)} ?`}
          label={
            selected.is_suspended ? "Rétablir le compte" : "Suspendre le compte"
          }
          danger={!selected.is_suspended}
          requireReason
          onClose={() => setSelected(null)}
          onConfirm={moderate}
        >
          <p>
            {!selected.is_suspended
              ? `Ce membre de la promotion ${selected.graduation_year} perdra l’accès au réseau. Son profil sera masqué. Un administrateur pourra annuler cette suspension.`
              : "Le membre retrouvera son accès et son profil sera à nouveau visible dans le réseau."}
          </p>
        </Confirm>
      )}
      {correction && (
        <Confirm
          title={`Corriger la promotion de ${fullName(correction)} ?`}
          label="Corriger la promotion"
          requireReason
          onClose={() => setCorrection(null)}
          onConfirm={async (reason) => {
            const year = Number(correctedYear);
            if (
              !Number.isInteger(year) ||
              year < 2017 ||
              year > 2040 ||
              year === correction.graduation_year
            )
              throw new Error(
                "Choisissez une nouvelle année de promotion valide.",
              );
            await rpc("hub_change_promotion", {
              p_member_id: correction.id,
              p_promotion: year,
              p_reason: reason,
            });
            setSuccess(
              `${fullName(correction)} est désormais rattaché à la promotion ${year}.`,
            );
            resource.refresh();
            promotions.refresh();
          }}
        >
          <p>
            Le membre sera rattaché à la nouvelle promotion. Cette correction
            sera conservée dans le journal de modération.
          </p>
          <label className="hub-field">
            Nouvelle promotion
            <input
              type="number"
              min="2017"
              max="2040"
              value={correctedYear}
              onChange={(e) => setCorrectedYear(e.target.value)}
            />
          </label>
        </Confirm>
      )}
    </>
  );
}

export function Team({ context, revision }: Common) {
  const staff = useResource(
    () => rpc<Staff[]>("hub_staff"),
    `staff-${revision}`,
  );
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const [role, setRole] = useState<"admin" | "moderator">("moderator");
  const [promotion, setPromotion] = useState("");
  const [pending, setPending] = useState<{
    id: string;
    name: string;
    role: "admin" | "moderator" | null;
    promotion: number | null;
  } | null>(null);
  const [success, setSuccess] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const members = useResource(
    () =>
      query.trim().length >= 2
        ? rpc<PageData<Member>>("hub_members", {
            p_search: query,
            p_promotion: null,
            p_status: "active",
            p_page: 1,
          })
        : Promise.resolve({ items: [], total: 0, page: 1, page_size: 25 }),
    `staff-search-${query}`,
  );
  const promos = useResource(
    () => rpc<Dashboard>("hub_dashboard"),
    `staff-promotions-${revision}`,
  );
  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>L’équipe du réseau.</h1>
          <p>Des responsabilités claires, promotion par promotion.</p>
        </div>
        <Refresh
          onClick={staff.refresh}
          loading={staff.loading}
          at={staff.at}
        />
      </div>
      {success && (
        <p className="hub-success" role="status">
          {success}
        </p>
      )}
      <div className="hub-team-layout">
        <section className="hub-panel">
          <div className="hub-panel-head">
            <div>
              <h2>Administrateurs & modérateurs</h2>
              <p>Les droits sont vérifiés pour chaque opération.</p>
            </div>
          </div>
          {staff.error && (
            <ErrorState message={staff.error} retry={staff.refresh} />
          )}
          {staff.loading && !staff.data && <Loading />}
          {staff.data &&
            (staff.data.length ? (
              <div className="hub-staff-list">
                {staff.data.map((s) => (
                  <div key={s.user_id} className="hub-staff-row">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>{s.display_name}</strong>
                      <span>
                        {roleName(s.role)} ·{" "}
                        {s.role === "admin"
                          ? "Toutes les promotions"
                          : `Promotion ${s.graduation_year}`}
                      </span>
                    </div>
                    {s.user_id === context.user_id ? (
                      <small>Vous</small>
                    ) : (
                      <button
                        className="hub-text-button danger-text"
                        onClick={() =>
                          setPending({
                            id: s.user_id,
                            name: s.display_name,
                            role: null,
                            promotion: null,
                          })
                        }
                      >
                        Retirer le rôle
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Aucun rôle attribué" />
            ))}
        </section>
        <section className="hub-panel hub-form-panel">
          <h2>Attribuer un rôle</h2>
          <p>Choisissez un membre actif du réseau.</p>
          <label className="hub-field">
            Rechercher un membre
            <input
              placeholder="Nom du membre (2 caractères min.)"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelected(null);
              }}
            />
          </label>
          {members.error && (
            <ErrorState message={members.error} retry={members.refresh} />
          )}
          {query.length >= 2 && !selected && (
            <div className="hub-search-results">
              {members.loading ? (
                <Loading />
              ) : members.data?.items.length ? (
                members.data.items
                  .filter(
                    (m) => m.id !== context.user_id && m.profile_completed,
                  )
                  .map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelected(m);
                        setPromotion(
                          m.graduation_year ? String(m.graduation_year) : "",
                        );
                      }}
                    >
                      {fullName(m)}
                      <small>
                        Promotion {m.graduation_year || "non renseignée"}
                      </small>
                    </button>
                  ))
              ) : (
                <p>Aucun membre actif trouvé.</p>
              )}
            </div>
          )}
          {selected && (
            <p className="hub-selected-member">
              <ShieldCheck size={16} />
              {fullName(selected)}
            </p>
          )}
          <label className="hub-field">
            Rôle
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "moderator")}
            >
              <option value="moderator">Modérateur de promotion</option>
              <option value="admin">Administrateur du réseau</option>
            </select>
          </label>
          {role === "moderator" && (
            <label className="hub-field">
              Promotion à modérer
              <select
                value={promotion}
                disabled={!selected}
                onChange={(e) => setPromotion(e.target.value)}
              >
                <option value="">Sélectionner un membre d’abord</option>
                {promos.data?.promotions
                  .filter((p) => p.year === selected?.graduation_year)
                  .map((p) => (
                    <option key={p.year} value={p.year}>
                      {p.year}
                    </option>
                  ))}
              </select>
              <small>
                Le modérateur doit appartenir à la promotion qu’il modère.
              </small>
            </label>
          )}
          <p className="hub-form-hint">
            {role === "admin"
              ? "L’administrateur gère tous les membres, les rôles, la maintenance et les journaux."
              : "Le modérateur peut consulter et suspendre les membres de sa promotion uniquement."}
          </p>
          <button
            className="hub-button primary"
            disabled={!selected || (role === "moderator" && !promotion)}
            onClick={() =>
              selected &&
              setPending({
                id: selected.id,
                name: fullName(selected),
                role,
                promotion: role === "moderator" ? Number(promotion) : null,
              })
            }
          >
            Attribuer le rôle <ArrowUpRight size={16} />
          </button>
        </section>
      </div>
      {pending && (
        <Confirm
          title={
            pending.role
              ? `Attribuer le rôle à ${pending.name} ?`
              : `Retirer le rôle de ${pending.name} ?`
          }
          label={pending.role ? "Confirmer les droits" : "Retirer le rôle"}
          danger={!pending.role}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await rpc("hub_set_staff", {
              p_member_id: pending.id,
              p_role: pending.role,
              p_promotion: pending.promotion,
            });
            setSuccess("Les droits ont été mis à jour.");
            staff.refresh();
            setSearch("");
            setSelected(null);
          }}
        >
          <p>
            {pending.role === "admin"
              ? "Cette personne obtiendra tous les droits d’administration, y compris la gestion des accès et la maintenance."
              : pending.role === "moderator"
                ? `Cette personne pourra modérer la promotion ${pending.promotion}.`
                : "Cette personne perdra son accès au hub. Son compte alumni restera actif."}
          </p>
        </Confirm>
      )}
    </>
  );
}

function localInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function Maintenance({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const resource = useResource(
    () => rpc<SiteStatus>("public_site_status"),
    `maintenance-${revision}`,
  );
  const [message, setMessage] = useState(
    "Nous améliorons votre réseau. Merci de votre patience.",
  );
  const [timed, setTimed] = useState(false);
  const [end, setEnd] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const state = resource.data;
  useEffect(() => {
    if (state && !dirty) {
      setMessage(
        state.message ||
          "Nous améliorons votre réseau. Merci de votre patience.",
      );
      setTimed(Boolean(state.ends_at));
      setEnd(localInput(state.ends_at));
    }
  }, [state, dirty]);
  useEffect(() => {
    const id = setInterval(resource.refresh, 30000);
    return () => clearInterval(id);
  }, [resource.refresh]);
  const serverOffset =
    state && resource.at
      ? new Date(state.server_time).getTime() - resource.at.getTime()
      : 0;
  function request(enabled: boolean) {
    setError("");
    if (enabled && message.trim().length < 10) {
      setError("Le message doit contenir au moins 10 caractères.");
      return;
    }
    if (
      enabled &&
      timed &&
      (!end || new Date(end).getTime() <= Date.now() + serverOffset)
    ) {
      setError("Choisissez une date de fin dans le futur.");
      return;
    }
    setPending(enabled);
  }
  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>Le temps d’une amélioration.</h1>
          <p>Gérez la disponibilité du site depuis cet espace indépendant.</p>
        </div>
        <Refresh
          onClick={resource.refresh}
          loading={resource.loading}
          at={resource.at}
        />
      </div>
      {resource.error && (
        <ErrorState message={resource.error} retry={resource.refresh} />
      )}
      {success && (
        <p className="hub-success" role="status">
          {success}
        </p>
      )}
      {resource.loading && !state && <Loading />}
      {state && (
        <div className="hub-availability">
          <Status active={!state.active}>
            {state.active ? "Maintenance en cours" : "Site ouvert"}
          </Status>
          <span>
            {state.active
              ? state.ends_at
                ? `Réouverture prévue le ${date(state.ends_at, true)}`
                : "Réouverture manuelle, sans limite de durée"
              : "Les membres peuvent accéder au réseau."}
          </span>
          {state.active && (
            <button
              className="hub-button primary"
              onClick={() => request(false)}
            >
              Remettre le site en ligne <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      )}
      <div className="hub-maintenance-layout">
        <section className="hub-panel hub-form-panel">
          <h2>Préparer la maintenance</h2>
          <p>L’activation est immédiate. Le hub reste accessible à l’équipe.</p>
          <label className="hub-field">
            Message pour les visiteurs
            <textarea
              maxLength={500}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setDirty(true);
              }}
              rows={4}
            />
            <small>{message.length}/500 caractères</small>
          </label>
          <fieldset className="hub-radio-group">
            <legend>Durée de la maintenance</legend>
            <label>
              <input
                type="radio"
                name="duration"
                checked={!timed}
                onChange={() => {
                  setTimed(false);
                  setDirty(true);
                }}
              />
              <span>
                Jusqu’à réouverture manuelle
                <small>Vous décidez quand remettre le site en ligne.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="duration"
                checked={timed}
                onChange={() => {
                  setTimed(true);
                  setDirty(true);
                }}
              />
              <span>
                Jusqu’à une date précise
                <small>
                  Réouverture automatique à la fin du compte à rebours.
                </small>
              </span>
            </label>
          </fieldset>
          {timed && (
            <label className="hub-field">
              Date et heure de réouverture
              <input
                type="datetime-local"
                value={end}
                min={localInput(
                  new Date(Date.now() + serverOffset + 60000).toISOString(),
                )}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setDirty(true);
                }}
              />
              <small>
                Fuseau de votre navigateur :{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}.
              </small>
            </label>
          )}
          {error && <ErrorState message={error} />}
          <button
            className="hub-button primary"
            disabled={!state || resource.loading}
            onClick={() => request(true)}
          >
            <Wrench size={16} />
            {state?.active
              ? "Mettre à jour la maintenance"
              : "Activer la maintenance"}
          </button>
        </section>
        <aside className="hub-maintenance-preview">
          <div className="hub-preview-label">
            <Eye size={15} />
            Aperçu du message public
          </div>
          <div className="hub-preview-paper">
            <img
              src="/images/brand/alumni-lsnb-logo-green.png"
              alt="LSNB Réseau"
            />
            <span className="hub-eyebrow">On se retrouve bientôt.</span>
            <h2>
              Le réseau prend
              <br />
              un peu de soin.
            </h2>
            <p>{message || "Votre message apparaîtra ici."}</p>
            {timed && end ? (
              <div className="hub-preview-date">
                <Clock3 size={17} />
                Retour prévu le {date(new Date(end), true)}
              </div>
            ) : (
              <div className="hub-preview-date">
                <Clock3 size={17} />
                Retour dès que tout sera prêt
              </div>
            )}
            <span className="hub-preview-footer">
              Les liens restent. Le réseau revient.
            </span>
          </div>
          <p className="hub-form-hint">
            Le compte à rebours public suit l’heure du serveur. Sans date de
            fin, aucun délai artificiel n’est affiché.
          </p>
        </aside>
      </div>
      {pending !== null && (
        <Confirm
          title={
            pending
              ? state?.active
                ? "Mettre à jour la maintenance ?"
                : "Mettre le site en maintenance ?"
              : "Rouvrir le réseau maintenant ?"
          }
          label={pending ? "Confirmer la maintenance" : "Remettre en ligne"}
          danger={pending}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await rpc("hub_set_maintenance", {
              p_enabled: pending,
              p_message: pending
                ? message.trim()
                : state?.message || "Le réseau est de nouveau disponible.",
              p_ends_at: pending && timed ? new Date(end).toISOString() : null,
            });
            setDirty(false);
            setSuccess(
              pending
                ? "La maintenance a été enregistrée."
                : "Le site est à nouveau ouvert.",
            );
            resource.refresh();
            onChanged();
          }}
        >
          <p>
            {pending
              ? `Les visiteurs et les membres verront la page de maintenance ${timed && end ? `jusqu’au ${date(new Date(end), true)}` : "jusqu’à votre réouverture manuelle"}. Les opérations du réseau seront temporairement bloquées.`
              : "Les membres pourront de nouveau utiliser toutes les fonctionnalités du réseau."}
          </p>
          <p>Votre accès au hub sera conservé.</p>
        </Confirm>
      )}
    </>
  );
}

export function AuditLog({ context, revision }: Common) {
  const [page, setPage] = useState(1);
  const resource = useResource(
    () => rpc<PageData<Audit>>("hub_audit", { p_page: page }),
    `audit-${page}-${revision}`,
  );
  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>Chaque décision laisse une trace.</h1>
          <p>
            {context.role === "admin"
              ? "Le journal des actions de l’équipe."
              : `Les actions de modération de la promotion ${context.graduation_year}.`}
          </p>
        </div>
        <Refresh
          onClick={resource.refresh}
          loading={resource.loading}
          at={resource.at}
        />
      </div>
      <section className="hub-panel">
        {resource.error && (
          <ErrorState message={resource.error} retry={resource.refresh} />
        )}
        {resource.loading && !resource.data && <Loading />}
        {resource.data && (
          <>
            {resource.data.items.length ? (
              <div className="hub-table-scroll">
                <table className="hub-audit-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Responsable</th>
                      <th>Membre / portée</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.items.map((a) => (
                      <tr key={a.id}>
                        <td>{date(a.created_at, true)}</td>
                        <th scope="row">{actionNames[a.action] || a.action}</th>
                        <td>{a.actor_name || "Compte supprimé"}</td>
                        <td>
                          {a.target_name || "Site"}
                          {a.graduation_year && (
                            <small className="hub-cell-sub">
                              Promotion {a.graduation_year}
                            </small>
                          )}
                        </td>
                        <td className="hub-reason-cell">{a.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Le journal est encore vide">
                Les prochaines actions de l’équipe apparaîtront ici.
              </Empty>
            )}
            <Pagination
              page={page}
              total={resource.data.total}
              size={resource.data.page_size}
              onPage={setPage}
            />
          </>
        )}
      </section>
    </>
  );
}

export function ServerLogs({
  token,
  revision,
}: {
  token: string;
  revision: number;
}) {
  const [level, setLevel] = useState("all");
  const resource = useResource(async (): Promise<LogData> => {
    if (demoRole)
      return {
        entries: [],
        started_at: new Date().toISOString(),
        retention: "process",
        service: "Aperçu local · aucun journal réel",
      };
    const base = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "");
    if (!base)
      throw new Error("L’adresse de l’API n’est pas configurée pour ce hub.");
    const response = await fetch(
      `${base}/api/v1/admin/logs?level=${level}&limit=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Session expirée ou droits insuffisants. Reconnectez-vous."
          : `Le serveur n’a pas retourné ses journaux (${response.status}).`,
      );
    return response.json() as Promise<LogData>;
  }, `logs-${level}-${revision}-${token}`);
  return (
    <>
      <div className="hub-section-heading">
        <div>
          <h1>À l’écoute du serveur.</h1>
          <p>
            Les événements récents de l’API, sans données personnelles ni
            secrets.
          </p>
        </div>
        <Refresh
          onClick={resource.refresh}
          loading={resource.loading}
          at={resource.at}
        />
      </div>
      <div className="hub-notice">
        <Terminal size={18} />
        <p>
          Journaux du processus en cours, limités aux 100 événements les plus
          récents. Ils sont réinitialisés au redémarrage du serveur. Les logs de
          déploiement restent disponibles chez l’hébergeur.
        </p>
      </div>
      <section className="hub-panel hub-log-panel">
        <div className="hub-panel-head">
          <div>
            <h2>{resource.data?.service || "Journal de l’API"}</h2>
            {resource.data?.started_at && (
              <p>Processus démarré le {date(resource.data.started_at, true)}</p>
            )}
          </div>
          <label className="hub-select-label">
            <span className="hub-sr-only">Filtrer par niveau</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="all">Tous les niveaux</option>
              <option value="info">Information</option>
              <option value="warn">Avertissement</option>
              <option value="error">Erreur</option>
            </select>
          </label>
        </div>
        {resource.error && (
          <ErrorState message={resource.error} retry={resource.refresh} />
        )}
        {resource.loading && !resource.data && <Loading />}
        {resource.data &&
          (resource.data.entries.length ? (
            <div className="hub-table-scroll">
              <table className="hub-log-table">
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th>Niveau</th>
                    <th>Événement</th>
                    <th>Requête</th>
                    <th>Statut</th>
                    <th>Durée</th>
                  </tr>
                </thead>
                <tbody>
                  {resource.data.entries.map((log) => (
                    <tr key={log.id}>
                      <td>{date(log.time, true)}</td>
                      <td>
                        <span className={`hub-log-level ${log.level}`}>
                          {log.level}
                        </span>
                      </td>
                      <td>
                        {log.event}
                        <small className="hub-cell-sub">{log.request_id}</small>
                      </td>
                      <td>
                        {log.method} {log.path || "—"}
                      </td>
                      <td>{log.status ?? "—"}</td>
                      <td>
                        {log.duration_ms !== undefined
                          ? `${log.duration_ms} ms`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Aucun événement pour ce filtre">
              Les événements apparaîtront après les prochaines requêtes reçues
              par l’API.
            </Empty>
          ))}
      </section>
    </>
  );
}
