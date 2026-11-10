import { ArrowLeft, Check, LoaderCircle, Network, RefreshCw, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Avatar } from "../components/ui/Avatar";
import { MemberConnectionRow } from "../components/mentoring/MemberConnectionRow";
import { MentorshipPerson } from "../components/mentoring/MentorshipPerson";
import { usePendingRequests } from "../components/mentoring/PendingRequestsProvider";
import { BlockedMembersSection } from "../components/safety/BlockedMembersSection";
import { Button } from "../components/ui/Button";
import { RouteStop } from "../components/visual/RouteStop";
import {
  answerConnectionRequest,
  endMentorship,
  getConnectionErrorMessage,
  loadActiveMentorships,
  loadConnectionRequests,
  loadMemberConnections,
  removeMemberConnection,
  withdrawConnectionRequest,
  type ConnectionRequest,
  type MemberConnection,
  type MemberSummary,
  type Mentorship,
} from "../lib/mentorshipRepository";
import { openRequests, requestKindLabel } from "../lib/relations";

const acceptedMessages: Record<ConnectionRequest["kind"], string> = {
  connection: "Connexion acceptée : vous êtes maintenant en relation.",
  mentoring: "Mentorat accepté. Votre relation apparaît dans vos réseaux.",
  contact: "Demande d’échange acceptée.",
};

function MemberIdentity({ member }: { member: MemberSummary | null }) {
  if (!member) return <span className="connection-card__person"><b>Profil indisponible</b></span>;
  return (
    <Link className="connection-card__person" to={`/alumni/${member.id}`}>
      <Avatar initials={member.initials} avatarTone={member.avatarTone} photoUrl={member.photoUrl} label={`Photo de ${member.firstName} ${member.lastName}`} />
      <span><b>{member.firstName} {member.lastName}</b>{member.graduationYear ? `Promotion ${member.graduationYear}` : member.specialty}</span>
    </Link>
  );
}

const requestStatusLabels = { pending: "En attente", accepted: "Acceptée", declined: "Refusée" };

export function ConnectionsPage() {
  const { user } = useAuth();
  const { refresh: refreshPendingRequests, revision: requestsRevision } = usePendingRequests();
  const userId = user?.id;
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ userId: string; requests?: ConnectionRequest[]; mentorships?: Mentorship[]; connections?: MemberConnection[]; error?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string }>();
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [endingId, setEndingId] = useState<string | null>(null);
  const endButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const currentUserId = useRef(userId);
  currentUserId.current = userId;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setBusy(null);
    setNotice(undefined);
    setConsents({});
    setEndingId(null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setState((previous) => previous?.userId === userId ? previous : { userId });
    void Promise.all([loadConnectionRequests(userId), loadActiveMentorships(userId), loadMemberConnections(userId)])
      .then(([requests, mentorships, connections]) => { if (active) setState({ userId, requests, mentorships, connections }); })
      .catch((error: unknown) => { if (active) setState({ userId, error: getConnectionErrorMessage(error) }); });
    return () => { active = false; };
  }, [userId, reload, requestsRevision]);

  // The header badge counts the same received requests as this list.
  const reloadConnections = () => {
    setReload((value) => value + 1);
    refreshPendingRequests();
  };

  const performAction = async (id: string, action: () => Promise<void>, message: string) => {
    if (busy || !userId) return;
    const actingUserId = userId;
    setBusy(id);
    setNotice(undefined);
    try {
      await action();
      if (!mounted.current || currentUserId.current !== actingUserId) return;
      setNotice({ kind: "success", message });
      setEndingId(null);
      reloadConnections();
    } catch (error) {
      if (mounted.current && currentUserId.current === actingUserId) {
        setNotice({ kind: "error", message: getConnectionErrorMessage(error) });
      }
    } finally {
      if (mounted.current && currentUserId.current === actingUserId) setBusy(null);
    }
  };

  if (!userId) return null;
  const current = state?.userId === userId ? state : undefined;
  const ready = current?.requests !== undefined && current.mentorships !== undefined && current.connections !== undefined;
  const connections = current?.connections ?? [];
  const { received, sent } = openRequests(userId, current?.requests ?? []);
  const mentors = current?.mentorships?.filter((item) => item.menteeId === userId) ?? [];
  const mentees = current?.mentorships?.filter((item) => item.mentorId === userId) ?? [];

  const renderRequest = (request: ConnectionRequest, incoming: boolean) => {
    const member = incoming ? request.requester : request.recipient;
    const unavailableMember = !request.requester || !request.recipient;
    const mentoringPaused = request.kind === "mentoring" && request.recipient?.offersMentoring !== true;
    const cannotAccept = unavailableMember || mentoringPaused;
    return (
      <li className="connection-card" key={request.id}>
        <div className="connection-card__heading">
          <MemberIdentity member={member} />
          <span className={`connection-status connection-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
        </div>
        <p className="connection-card__kind">{requestKindLabel(request)}</p>
        {request.offerId && (
          <p className="connection-card__offer">
            {request.offer
              ? <>Offre : <Link className="text-link text-link--dark" to={`/offres/${request.offer.id}`}>{request.offer.title}</Link></>
              : "Cette offre n’est plus visible."}
          </p>
        )}
        <p className="connection-card__message">{request.message}</p>
        <time dateTime={request.createdAt}>Envoyée le {new Date(request.createdAt).toLocaleDateString("fr-FR")}</time>
        {request.status === "pending" && incoming && (
          <>
            {request.kind === "mentoring" && (
              <label className="form-check">
                <input type="checkbox" checked={consents[request.id] ?? false} onChange={(event) => setConsents((value) => ({ ...value, [request.id]: event.target.checked }))} disabled={Boolean(busy) || cannotAccept} />
                <span>J’accepte que ce mentorat apparaisse sur nos deux profils, visible par les membres connectés.</span>
              </label>
            )}
            {unavailableMember ? <p className="connection-card__note">Ce profil n’est plus disponible. Vous pouvez refuser la demande.</p>
              : mentoringPaused && <p className="connection-card__note">Réactivez votre offre de mentorat dans <Link className="text-link text-link--dark" to="/espace/modifier">Modifier mon profil</Link> pour accepter cette demande.</p>}
            <div className="connection-card__actions">
              <Button size="sm" disabled={Boolean(busy) || cannotAccept || (request.kind === "mentoring" && !consents[request.id])} onClick={() => void performAction(request.id, () => answerConnectionRequest(request.id, "accepted"), acceptedMessages[request.kind])}>
                {busy === request.id ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />} Accepter
              </Button>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void performAction(request.id, () => answerConnectionRequest(request.id, "declined"), "La demande a été refusée.")}><X size={15} aria-hidden="true" /> Refuser</Button>
            </div>
          </>
        )}
        {request.status === "pending" && !incoming && (
          <div className="connection-card__actions"><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void performAction(request.id, () => withdrawConnectionRequest(request.id), "Votre demande a été retirée.")}>Retirer ma demande</Button></div>
        )}
      </li>
    );
  };

  const renderMentorship = (mentorship: Mentorship, role: "mentor" | "mentee") => {
    const member = role === "mentor" ? mentorship.mentor : mentorship.mentee;
    return (
      <li className="mentorship-row" key={mentorship.id}>
        {member ? <MentorshipPerson member={member} /> : <p className="mentorship-row__unavailable">Profil indisponible</p>}
        <div className="mentorship-row__details">
          <time dateTime={mentorship.createdAt}>Depuis le {new Date(mentorship.createdAt).toLocaleDateString("fr-FR")}</time>
          <button ref={(element) => { endButtons.current[mentorship.id] = element; }} type="button" className="button button--ghost button--sm" disabled={Boolean(busy)} aria-expanded={endingId === mentorship.id} aria-controls={`end-mentorship-${mentorship.id}`} aria-label={`Terminer le mentorat${member ? ` avec ${member.firstName} ${member.lastName}` : " avec ce profil indisponible"}`} onClick={() => setEndingId(endingId === mentorship.id ? null : mentorship.id)}>Terminer le mentorat</button>
        </div>
          <div className="connection-confirm" id={`end-mentorship-${mentorship.id}`} hidden={endingId !== mentorship.id}>
            <p>Terminer ce mentorat ? Il sera retiré des listes et compteurs sur vos deux profils.</p>
            <div className="connection-card__actions">
              <Button size="sm" disabled={Boolean(busy)} onClick={() => void performAction(mentorship.id, () => endMentorship(mentorship.id), "Le mentorat est terminé et retiré de vos réseaux.")}>Confirmer la fin</Button>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => { setEndingId(null); endButtons.current[mentorship.id]?.focus(); }}>Conserver le mentorat</Button>
            </div>
          </div>
      </li>
    );
  };

  // Shares the confirmation state with mentorships: ids are unique across both lists.
  const renderConnection = (connection: MemberConnection) => (
    <MemberConnectionRow
      key={connection.id}
      connection={connection}
      busy={Boolean(busy)}
      confirming={endingId === connection.id}
      toggleRef={(element) => { endButtons.current[connection.id] = element; }}
      onToggle={() => setEndingId(endingId === connection.id ? null : connection.id)}
      onRemove={() => void performAction(connection.id, () => removeMemberConnection(connection.id), "La relation a été retirée.")}
      onKeep={() => { setEndingId(null); endButtons.current[connection.id]?.focus(); }}
    />
  );

  return (
    <div className="connections-page page-shell">
      <Link to={`/alumni/${userId}`} className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Retour à mon profil</Link>
      <header className="connections-page__header">
        <RouteStop>Des parcours qui se rencontrent</RouteStop>
        <h1>Mes relations et demandes</h1>
        <p>Retrouvez vos connexions, les demandes de connexion, d’échange et de mentorat, puis choisissez les relations que vous souhaitez faire vivre.</p>
      </header>
      <div className="connections-page__toolbar">
        <p>Vos connexions ne sont visibles que par vous deux. Les mentorats acceptés sont visibles par les membres connectés. Les messages des demandes restent privés entre les deux personnes.</p>
        <Button variant="outline" size="sm" disabled={Boolean(busy) || (!ready && !current?.error)} onClick={reloadConnections}><RefreshCw size={16} aria-hidden="true" /> Actualiser</Button>
      </div>
      {notice && <div className={`form-status form-status--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</div>}
      {current?.error ? (
        <div className="form-status form-status--error" role="alert">{current.error}<Button variant="outline" onClick={reloadConnections}>Réessayer</Button></div>
      ) : !ready ? (
        <p className="connections-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Chargement de vos relations, demandes et mentorats…</p>
      ) : (
        <>
          <div className="connections-columns">
            <section className="connections-section" aria-labelledby="received-requests-title">
              <div className="connections-section__heading"><h2 id="received-requests-title">Demandes reçues</h2><span className="connections-count">{received.length}</span></div>
              {received.length ? <ul className="connections-list">{received.map((request) => renderRequest(request, true))}</ul> : <p className="connections-empty">Aucune demande reçue pour le moment.</p>}
            </section>
            <section className="connections-section" aria-labelledby="sent-requests-title">
              <div className="connections-section__heading"><h2 id="sent-requests-title">Demandes envoyées</h2><span className="connections-count">{sent.length}</span></div>
              {sent.length ? <ul className="connections-list">{sent.map((request) => renderRequest(request, false))}</ul> : <p className="connections-empty">Aucune demande envoyée. <Link className="text-link text-link--dark" to="/annuaire">Explorer l’annuaire</Link></p>}
            </section>
          </div>
          <section className="connections-section" aria-labelledby="member-connections-title">
            <div className="connections-section__heading"><h2 id="member-connections-title"><Users size={20} aria-hidden="true" /> Mes connexions</h2><span className="connections-count">{connections.length}</span></div>
            {connections.length ? <ul className="connections-list">{connections.map(renderConnection)}</ul> : <p className="connections-empty">Vous n’êtes encore en relation avec personne. <Link className="text-link text-link--dark" to="/annuaire">Explorer l’annuaire</Link></p>}
          </section>
          <section className="connections-section" aria-labelledby="active-mentorships-title">
            <div className="connections-section__heading"><h2 id="active-mentorships-title"><Network size={20} aria-hidden="true" /> Mon réseau de mentorat</h2></div>
            <div className="connections-columns connections-columns--mentorships">
              <section aria-labelledby="my-mentors-title"><div className="connections-section__heading"><h2 id="my-mentors-title">Mes mentors</h2><span className="connections-count">{mentors.length}</span></div>{mentors.length ? <ul className="connections-list">{mentors.map((item) => renderMentorship(item, "mentor"))}</ul> : <p className="connections-empty">Aucun mentorat en cours avec un mentor.</p>}</section>
              <section aria-labelledby="my-mentees-title"><div className="connections-section__heading"><h2 id="my-mentees-title">Mes mentorés</h2><span className="connections-count">{mentees.length}</span></div>{mentees.length ? <ul className="connections-list">{mentees.map((item) => renderMentorship(item, "mentee"))}</ul> : <p className="connections-empty">Vous n’accompagnez personne pour le moment.</p>}</section>
            </div>
          </section>
          <BlockedMembersSection />
        </>
      )}
    </div>
  );
}
