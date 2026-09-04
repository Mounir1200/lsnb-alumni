import {
  ArrowLeft,
  BookOpen,
  Check,
  GraduationCap,
  MapPin,
  MessageCircle,
  Orbit,
  PencilLine,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Avatar } from "../components/ui/Avatar";
import { Button, ButtonLink } from "../components/ui/Button";
import { alumniProfiles, getAlumniProfile, type AlumniProfile } from "../data/alumni";
import { loadProfile } from "../lib/profileRepository";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { NotFoundPage } from "./NotFoundPage";

type RequestStatus = {
  kind: "idle" | "loading" | "success" | "error" | "login";
  message?: string;
};

export function ProfilePage() {
  const { profileId = "" } = useParams();
  const { user } = useAuth();
  const demoProfile = getAlumniProfile(profileId);
  const [profile, setProfile] = useState<AlumniProfile | undefined>(demoProfile);
  const [loading, setLoading] = useState(Boolean(!demoProfile && isSupabaseConfigured));
  const [requestSent, setRequestSent] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>({ kind: "idle" });

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

    if (!isSupabaseConfigured) {
      setProfile(undefined);
      setLoading(false);
      return;
    }

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
  }, [profileId]);

  if (loading) {
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

  const handleRequestClick = () => {
    if (profile.isDemo !== false) {
      setRequestSent(true);
      return;
    }
    setRequestOpen(true);
  };

  const handleRequestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setRequestStatus({ kind: "error", message: "Supabase n’est pas configuré." });
      return;
    }

    setRequestStatus({ kind: "loading" });
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setRequestStatus({
        kind: "login",
        message: "Connectez-vous pour envoyer cette demande.",
      });
      return;
    }
    if (authData.user.id === profile.id) {
      setRequestStatus({ kind: "error", message: "Vous ne pouvez pas vous envoyer une demande." });
      return;
    }

    const data = new FormData(event.currentTarget);
    const { error } = await supabase.from("connection_requests").insert({
      requester_id: authData.user.id,
      recipient_id: profile.id,
      request_kind: profile.offersMentoring ? "mentoring" : "contact",
      message: String(data.get("message") ?? "").trim(),
    });

    if (error) {
      setRequestStatus({ kind: "error", message: error.message });
      return;
    }

    setRequestSent(true);
    setRequestOpen(false);
    setRequestStatus({ kind: "success", message: "Votre demande a été transmise." });
  };

  return (
    <div className="profile-page">
      <div className="page-shell">
        <Link to="/annuaire" className="back-link">
          <ArrowLeft size={17} aria-hidden="true" /> Retour à l’annuaire
        </Link>

        <section className="profile-hero" aria-labelledby="profile-name">
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
              <p>
                {profile.currentRole}
                {profile.organization ? ` · ${profile.organization}` : ""}
              </p>
              <span><MapPin size={16} aria-hidden="true" /> {profile.city}, {profile.country}</span>
            </div>
          </div>

          <div className="profile-hero__action">
            {profile.offersMentoring && (
              <p><Orbit size={17} aria-hidden="true" /> Mentorat ouvert</p>
            )}
            {isOwnProfile ? (
              <ButtonLink to="/espace/modifier" size="lg">
                <PencilLine size={18} aria-hidden="true" /> Modifier mon profil
              </ButtonLink>
            ) : (
              <Button
                size="lg"
                onClick={handleRequestClick}
                disabled={requestSent}
              >
                {requestSent ? (
                  <><Check size={18} aria-hidden="true" /> Demande enregistrée</>
                ) : (
                  <><MessageCircle size={18} aria-hidden="true" /> Demander un échange</>
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
          </div>
        </section>

        {requestOpen && (
          <form className="profile-request-form" onSubmit={handleRequestSubmit}>
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
                placeholder="Expliquez brièvement votre situation et le conseil recherché."
                required
              />
            </label>
            {requestStatus.message && (
              <div className={`form-status form-status--${requestStatus.kind}`} role="status">
                {requestStatus.message}
                {requestStatus.kind === "login" && <Link to="/connexion">Se connecter</Link>}
              </div>
            )}
            <div className="profile-request-form__actions">
              <Button variant="outline" onClick={() => setRequestOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={requestStatus.kind === "loading"}>Envoyer la demande</Button>
            </div>
          </form>
        )}

        <div className="profile-layout">
          <article className="profile-story">
            <p className="eyebrow eyebrow--dark">Son parcours</p>
            <blockquote>“{profile.experience}”</blockquote>

            <section>
              <h2><GraduationCap aria-hidden="true" /> Formation</h2>
              <ol>
                <li>
                  <span>{profile.graduationYear}</span>
                  <div><b>Baccalauréat scientifique</b><p>LSNB · Bobo-Dioulasso</p></div>
                </li>
                {profile.education.map((education, index) => (
                  <li key={education}>
                    <span>0{index + 2}</span>
                    <div><b>{education}</b></div>
                  </li>
                ))}
              </ol>
            </section>
          </article>

          <aside className="profile-aside">
            <section>
              <p>Spécialités</p>
              <div className="specialty-list">
                {profile.specialties.map((specialty) => <span key={specialty}>{specialty}</span>)}
              </div>
            </section>

            {profile.offersMentoring && (
              <section className="profile-mentoring-card">
                <Orbit aria-hidden="true" />
                <h2>Ce que {profile.firstName} peut partager</h2>
                {profile.mentoringTopics.length > 0 ? (
                  <ul>
                    {profile.mentoringTopics.map((topic) => <li key={topic}>{topic}</li>)}
                  </ul>
                ) : (
                  <span>Les thèmes seront précisés lors de la demande.</span>
                )}
                {profile.availability && <p>{profile.availability}</p>}
              </section>
            )}

            {profile.isDemo !== false && (
              <section className="profile-demo-notice">
                <BookOpen aria-hidden="true" />
                <p>
                  Ce profil est fictif et sert uniquement à tester l’interface. Il sera remplacé
                  par les données vérifiées des membres.
                </p>
              </section>
            )}
          </aside>
        </div>

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

        <div className="profile-next-action">
          <p>Vous avez aussi un parcours à partager&nbsp;?</p>
          <ButtonLink to="/rejoindre" variant="outline">Créer mon profil</ButtonLink>
        </div>
      </div>
    </div>
  );
}
