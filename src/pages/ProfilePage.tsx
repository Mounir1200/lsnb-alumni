import {
  ArrowLeft,
  Check,
  GraduationCap,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Orbit,
  PencilLine,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ProfileMentorshipNetwork } from "../components/mentoring/ProfileMentorshipNetwork";
import { ProfileAside } from "../components/profile/ProfileAside";
import { ProfileMilestones } from "../components/profile/ProfileMilestones";
import { ProfileStory } from "../components/profile/ProfileStory";
import { ProfileTrajectory } from "../components/profile/ProfileTrajectory";
import "../components/profile/Profile.css";
import { Avatar } from "../components/ui/Avatar";
import { Button, ButtonLink } from "../components/ui/Button";
import { alumniProfiles, getAlumniProfile, type AlumniProfile } from "../data/alumni";
import { loadProfile } from "../lib/profileRepository";
import { getProfileCompletionPath } from "../lib/auth";
import { normalizeSearchText } from "../lib/searchText";
import { createConnectionRequest, getConnectionErrorMessage, loadActiveMentorships, loadProfileConnections, type ConnectionRequest, type Mentorship } from "../lib/mentorshipRepository";
import { isSupabaseConfigured } from "../lib/supabase";
import { NotFoundPage } from "./NotFoundPage";

type RequestStatus = {
  kind: "idle" | "loading" | "success" | "error" | "login";
  message?: string;
};

export function ProfilePage() {
  const { profileId = "" } = useParams();
  const { user, isLoading: authLoading, profileCompleted } = useAuth();
  const demoProfile = getAlumniProfile(profileId);
  const [profile, setProfile] = useState<AlumniProfile | undefined>(demoProfile);
  const [loading, setLoading] = useState(Boolean(!demoProfile && isSupabaseConfigured));
  const [requestSent, setRequestSent] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>({ kind: "idle" });
  const [connectionsReload, setConnectionsReload] = useState(0);
  const [connections, setConnections] = useState<{ scope: string; requests?: ConnectionRequest[]; mentorships?: Mentorship[]; error?: string }>();
  const requestScope = `${user?.id ?? ""}:${profileId}`;
  const currentScope = useRef(requestScope);
  currentScope.current = requestScope;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setRequestSent(false);
    setRequestOpen(false);
    setRequestStatus({ kind: "idle" });

    const localProfile = getAlumniProfile(profileId);
    if (localProfile) {
      setProfile(localProfile);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured || (!authLoading && !user)) {
      setProfile(undefined);
      setLoading(false);
      return;
    }

    if (authLoading) return;

    let active = true;
    setLoading(true);
    loadProfile(profileId)
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch(() => {
        if (active) setProfile(undefined);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profileId, user?.id, authLoading]);

  useEffect(() => {
    if (!user || !profileCompleted || demoProfile || authLoading) return;
    let active = true;
    setConnections({ scope: requestScope });
    void Promise.all([loadProfileConnections(user.id, profileId), loadActiveMentorships(user.id)])
      .then(([requests, mentorships]) => { if (active) setConnections({ scope: requestScope, requests, mentorships }); })
      .catch((error: unknown) => { if (active) setConnections({ scope: requestScope, error: getConnectionErrorMessage(error) }); });
    return () => { active = false; };
  }, [user?.id, profileId, profileCompleted, authLoading, Boolean(demoProfile), connectionsReload, requestScope]);

  if (!demoProfile && isSupabaseConfigured && !authLoading && !user) {
    return (
      <section className="auth-state-page">
        <h1>Retrouvez ce membre du réseau.</h1>
        <p>Connectez-vous pour consulter son profil et son réseau de mentorat.</p>
        <ButtonLink to={`/connexion?next=${encodeURIComponent(`/alumni/${profileId}`)}`}>Se connecter</ButtonLink>
      </section>
    );
  }

  if (loading || authLoading || (profile && profile.id !== profileId)) {
    return (
      <section className="simple-page page-shell" aria-live="polite">
        <p className="eyebrow eyebrow--dark">Chargement</p>
        <h1>Nous retrouvons ce parcours.</h1>
      </section>
    );
  }

  if (!profile) return <NotFoundPage />;

  const relatedProfiles = profile.isDemo === false
    ? []
    : alumniProfiles
        .filter((item) => item.id !== profile.id && item.domain === profile.domain)
        .slice(0, 2);
  const isOwnProfile = profile.isDemo === false && user?.id === profile.id;
  // Without a current job the role falls back to the specialty, often the domain shown just above.
  const repeatsDomain = normalizeSearchText(profile.currentRole) === normalizeSearchText(profile.domain);
  const roleLine = [repeatsDomain ? "" : profile.currentRole, profile.organization].filter(Boolean).join(" · ");
  const currentConnections = connections?.scope === requestScope ? connections : undefined;
  const connectionsReady = currentConnections?.requests !== undefined && currentConnections.mentorships !== undefined;
  const requestKind = profile.offersMentoring ? "mentoring" : "contact";
  const relevantRequests = currentConnections?.requests?.filter((item) => item.kind === requestKind) ?? [];
  const pendingRequest = relevantRequests.find((item) => item.status === "pending" && (
    requestKind === "contact" || item.requesterId === user?.id
  ));
  const activeMentorship = currentConnections?.mentorships?.find((item) => item.mentorId === profile.id && item.menteeId === user?.id);
  const acceptedContact = requestKind === "contact" && relevantRequests.some((item) => item.status === "accepted");
  const relationshipExists = requestKind === "mentoring" ? Boolean(activeMentorship) : acceptedContact;
  const declinedRequest = relevantRequests.find((item) => item.status === "declined" && item.requesterId === user?.id);
  const requestUnavailable = profile.isDemo === false && (!connectionsReady || Boolean(pendingRequest) || relationshipExists);

  const handleRequestClick = () => {
    if (profile.isDemo !== false) {
      setRequestSent(true);
      return;
    }
    setRequestOpen(true);
  };

  const handleRequestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !profileCompleted) {
      setRequestStatus({
        kind: "login",
        message: "Connectez-vous et complétez votre profil pour envoyer cette demande.",
      });
      return;
    }
    if (user.id === profile.id) {
      setRequestStatus({ kind: "error", message: "Vous ne pouvez pas vous envoyer une demande." });
      return;
    }
    if (requestStatus.kind === "loading" || requestUnavailable) return;
    const data = new FormData(event.currentTarget);
    if (requestKind === "mentoring" && data.get("networkConsent") !== "on") {
      setRequestStatus({ kind: "error", message: "Confirmez la visibilité du mentorat avant d’envoyer votre demande." });
      return;
    }
    const actingScope = requestScope;
    setRequestStatus({ kind: "loading" });
    try {
      await createConnectionRequest(user.id, profile.id, requestKind, String(data.get("message") ?? "").trim());
      if (!mounted.current || currentScope.current !== actingScope) return;
      setRequestSent(true);
      setRequestOpen(false);
      setRequestStatus({ kind: "success", message: "Votre demande a été transmise. Retrouvez-la dans Mes relations et demandes." });
      setConnectionsReload((value) => value + 1);
    } catch (error) {
      if (mounted.current && currentScope.current === actingScope) setRequestStatus({ kind: "error", message: getConnectionErrorMessage(error) });
    }
  };

  return (
    <div className="profile-page">
      <div className="page-shell">
        <Link to="/annuaire" className="back-link">
          <ArrowLeft size={17} aria-hidden="true" /> Retour à l’annuaire
        </Link>

        <section className="profile-hero" aria-labelledby="profile-name">
          <div className="profile-hero__main">
            <div className="profile-hero__identity">
              <Avatar
                initials={profile.initials}
                avatarTone={profile.avatarTone}
                photoUrl={profile.photoUrl}
                label={`${profile.isDemo === false ? "Photo" : "Portrait fictif"} de ${profile.firstName} ${profile.lastName}`}
              />
              <div>
                <p className="profile-hero__domain">{profile.domain}</p>
                <h1 id="profile-name">{profile.firstName} {profile.lastName}</h1>
                {roleLine && <p className="profile-hero__role">{roleLine}</p>}
                <ul className="profile-hero__facts" aria-label={`Repères de ${profile.firstName}`}>
                  <li><MapPin size={15} aria-hidden="true" /> {profile.city}, {profile.country}</li>
                  <li><GraduationCap size={15} aria-hidden="true" /> Promotion {profile.graduationYear}</li>
                  {profile.offersMentoring && <li className="is-mentoring"><Orbit size={15} aria-hidden="true" /> Mentorat ouvert</li>}
                </ul>
              </div>
            </div>

            <div className="profile-hero__action">
              {isOwnProfile ? (
                <ButtonLink to="/espace/modifier" size="lg">
                  <PencilLine size={18} aria-hidden="true" /> Modifier mon profil
                </ButtonLink>
              ) : profile.isDemo === false && !profileCompleted ? (
                <ButtonLink to={getProfileCompletionPath(`/alumni/${profileId}`)} size="lg">Compléter mon profil</ButtonLink>
              ) : (
                <Button
                  size="lg"
                  onClick={handleRequestClick}
                  disabled={(profile.isDemo !== false && requestSent) || requestUnavailable}
                >
                  {profile.isDemo === false && !connectionsReady && !currentConnections?.error ? (
                    <><LoaderCircle size={18} className="spin" aria-hidden="true" /> Vérification des demandes…</>
                  ) : relationshipExists ? (
                    <><Check size={18} aria-hidden="true" /> {requestKind === "mentoring" ? "Mentorat en cours" : "Échange accepté"}</>
                  ) : pendingRequest ? (
                    <><Check size={18} aria-hidden="true" /> {pendingRequest.requesterId === user?.id ? "Demande en attente" : "Demande reçue"}</>
                  ) : requestSent && profile.isDemo !== false ? (
                    <><Check size={18} aria-hidden="true" /> Demande enregistrée</>
                  ) : (
                    <><MessageCircle size={18} aria-hidden="true" /> {requestKind === "mentoring" ? "Demander un mentorat" : "Demander un échange"}</>
                  )}
                </Button>
              )}
              {!isOwnProfile && requestSent && (
                <span role="status">
                  {profile.isDemo === false
                    ? requestStatus.message ?? "Demande enregistrée."
                    : "Mode démonstration : aucun message réel n’a été envoyé."}
                </span>
              )}
              {!isOwnProfile && currentConnections?.error && <span role="alert">{currentConnections.error} <Button size="sm" variant="light" onClick={() => setConnectionsReload((value) => value + 1)}>Réessayer</Button></span>}
              {!isOwnProfile && (pendingRequest || relationshipExists || requestSent) && profile.isDemo === false && <ButtonLink to="/espace/relations" size="sm" variant="light">Gérer mes relations et demandes</ButtonLink>}
              {!isOwnProfile && connectionsReady && declinedRequest && !pendingRequest && !relationshipExists && !requestSent && <span>Votre précédente demande a été refusée. Vous pouvez formuler une nouvelle demande.</span>}
            </div>
          </div>

          <ProfileTrajectory city={profile.city} country={profile.country} />
        </section>

        {requestOpen && !requestUnavailable && (
          <form key={requestScope} className="profile-request-form" onSubmit={handleRequestSubmit}>
            <div>
              <p className="eyebrow eyebrow--dark">
                {profile.offersMentoring ? "Demande de mentorat" : "Demande de contact"}
              </p>
              <h2>Présentez votre question à {profile.firstName}.</h2>
            </div>
            <label className="field-group">
              <span>Votre message</span>
              <textarea
                name="message"
                rows={4}
                minLength={20}
                maxLength={1200}
                disabled={requestStatus.kind === "loading"}
                placeholder="Expliquez brièvement votre situation et le conseil recherché."
                required
              />
              <small>20 à 1 200 caractères. Ce message est visible uniquement par vous et son destinataire.</small>
            </label>
            {requestKind === "mentoring" && (
              <label className="form-check">
                <input type="checkbox" name="networkConsent" required disabled={requestStatus.kind === "loading"} />
                <span>Si cette demande est acceptée, j’accepte que notre mentorat apparaisse sur nos deux profils, visible par les membres connectés.</span>
              </label>
            )}
            {requestStatus.message && (
              <div className={`form-status form-status--${requestStatus.kind}`} role="status">
                {requestStatus.message}
                {requestStatus.kind === "login" && <Link to="/connexion">Se connecter</Link>}
              </div>
            )}
            <div className="profile-request-form__actions">
              <Button variant="outline" disabled={requestStatus.kind === "loading"} onClick={() => setRequestOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={requestStatus.kind === "loading"}>Envoyer la demande</Button>
            </div>
          </form>
        )}

        <div className="profile-layout">
          <div className="profile-main">
            <ProfileStory firstName={profile.firstName} story={profile.experience} />
            <ProfileMilestones profile={profile} />
          </div>
          <ProfileAside profile={profile} />
        </div>

        <ProfileMentorshipNetwork profileId={profile.id} firstName={profile.firstName} isDemo={profile.isDemo !== false} />

        {relatedProfiles.length > 0 && (
          <section className="profile-related">
            <h2>D’autres parcours en {profile.domain.toLowerCase()}</h2>
            {relatedProfiles.map((item) => (
              <Link key={item.id} to={`/alumni/${item.id}`}>
                <Avatar initials={item.initials} avatarTone={item.avatarTone} photoUrl={item.photoUrl} />
                <span><b>{item.firstName} {item.lastName}</b>{item.currentRole}</span>
              </Link>
            ))}
          </section>
        )}

        {!user && (
          <div className="profile-next-action">
            <p>Vous avez aussi un parcours à partager&nbsp;?</p>
            <ButtonLink to="/rejoindre" variant="outline">Créer mon profil</ButtonLink>
          </div>
        )}
      </div>
    </div>
  );
}
