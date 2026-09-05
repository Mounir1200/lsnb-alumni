import { LoaderCircle, LogOut, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui/Button";
import { getPostAuthPath } from "../lib/auth";
import { completeMemberProfile, loadOnboardingProfile, type OnboardingProfile } from "../lib/onboardingRepository";
import { supabase } from "../lib/supabase";

export function CompleteProfilePage() {
  const { user, refreshProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const next = getPostAuthPath(searchParams.get("next"));
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [role, setRole] = useState<"alumni" | "student" | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setProfile(null);
    setRole(null);
    setBusy(false);
    setError(null);
    void loadOnboardingProfile(user.id).then(async (value) => {
      if (!active) return;
      if (value.profile_completed) {
        await refreshProfile();
        if (active) navigate(next, { replace: true });
      } else setProfile(value);
    }).catch(() => { if (active) setError("Impossible de charger votre profil. Réessayez."); });
    return () => { active = false; };
  }, [user?.id, reload, next, navigate, refreshProfile]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!role || busy || profile?.id !== user?.id) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await completeMemberProfile({
        firstName: String(data.get("firstName") ?? ""), lastName: String(data.get("lastName") ?? ""),
        memberRole: role, graduationYear: Number(data.get("graduationYear")),
        specialty: String(data.get("specialty") ?? ""), city: String(data.get("city") ?? ""),
        country: String(data.get("country") ?? ""), experience: String(data.get("experience") ?? ""),
        gender: String(data.get("gender") ?? "unspecified") as "male" | "female" | "unspecified",
        offersMentoring: data.get("offersMentoring") === "on", contactVisible: data.get("contactVisible") === "on",
        termsAccepted: data.get("termsAccepted") === "on",
      });
      await refreshProfile();
      navigate(next, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d’enregistrer votre profil.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) { setError("La déconnexion a échoué. Réessayez."); setBusy(false); }
    else navigate("/connexion", { replace: true });
  };

  return (
    <div className="account-page">
      <div className="page-shell account-page__grid">
        <aside className="account-story">
          <p className="eyebrow">Bienvenue dans le réseau</p>
          <h1>Votre identité est confirmée.<br />Racontez votre parcours.</h1>
          <p>Choisissez votre statut et ajoutez les repères utiles aux autres membres. Votre profil apparaîtra dans l’annuaire une fois cette étape terminée.</p>
          <div className="account-story__principles"><span><UserRound aria-hidden="true" /><b>Un profil qui vous ressemble</b>Vérifiez votre nom et partagez vos expériences.</span></div>
        </aside>
        <section className="account-form-wrap" aria-labelledby="complete-profile-title">
          <div className="account-form-wrap__header"><p id="complete-profile-title">Compléter mon profil</p><span>{user?.email}</span></div>
          {!profile || profile.id !== user?.id ? (
            <div className="account-form" role="status">
              {error ? <><p>{error}</p><Button onClick={() => setReload((value) => value + 1)}>Réessayer</Button></>
                : <p><LoaderCircle className="spin" aria-hidden="true" /> Chargement de votre profil…</p>}
            </div>
          ) : (
            <form key={profile.id} className="account-form" onSubmit={submit}>
              <fieldset className="role-picker" disabled={busy}>
                <legend>Je suis</legend>
                <label className={role === "alumni" ? "is-selected" : ""}><input type="radio" name="role" value="alumni" required checked={role === "alumni"} onChange={() => setRole("alumni")} /><b>Alumni</b><span>Ancien·ne élève du LSNB</span></label>
                <label className={role === "student" ? "is-selected" : ""}><input type="radio" name="role" value="student" required checked={role === "student"} onChange={() => setRole("student")} /><b>Élève</b><span>Actuellement au LSNB</span></label>
              </fieldset>
              <div className="form-row">
                <label className="field-group"><span>Prénom</span><input name="firstName" autoComplete="given-name" defaultValue={profile.first_name} maxLength={100} required disabled={busy} /></label>
                <label className="field-group"><span>Nom</span><input name="lastName" autoComplete="family-name" defaultValue={profile.last_name} maxLength={100} required disabled={busy} /></label>
              </div>
              <label className="field-group"><span>Genre (facultatif)</span><select name="gender" defaultValue="unspecified" disabled={busy}><option value="unspecified">Je préfère ne pas préciser</option><option value="female">Femme</option><option value="male">Homme</option></select><small>Sert à équilibrer les duos Highlight ; il n’est pas déduit de votre identité Google.</small></label>
              <div className="form-row">
                <label className="field-group"><span>{role === "student" ? "Année prévue du bac" : "Année du bac"}</span><input name="graduationYear" type="number" min={2017} max={2040} required disabled={busy} /></label>
                <label className="field-group"><span>Spécialité ou domaine</span><input name="specialty" maxLength={200} placeholder="Ex. génie civil" required disabled={busy} /></label>
              </div>
              <div className="form-row">
                <label className="field-group"><span>Ville</span><input name="city" autoComplete="address-level2" maxLength={150} required disabled={busy} /></label>
                <label className="field-group"><span>Pays</span><input name="country" autoComplete="country-name" maxLength={150} required disabled={busy} /></label>
              </div>
              <label className="field-group"><span>Parcours et expériences</span><textarea name="experience" rows={5} maxLength={5000} placeholder="Études, transitions, activité actuelle et ce que vous aimeriez partager." required disabled={busy} /></label>
              {role === "alumni" && <label className="form-check form-check--mentor"><input name="offersMentoring" type="checkbox" disabled={busy} /><span><b>Je souhaite proposer du mentorat</b>Je pourrai accepter ou refuser les demandes.</span></label>}
              <label className="form-check"><input name="contactVisible" type="checkbox" disabled={busy} /><span><b>Rendre mon contact visible aux membres</b>Ce choix peut être modifié plus tard.</span></label>
              <label className="form-consent"><input name="termsAccepted" type="checkbox" required disabled={busy} /><span>J’accepte que ces informations soient utilisées pour mon profil LSNB Réseau. <Link to="/confidentialite">Voir la politique de confidentialité.</Link></span></label>
              {role === "alumni" && <p className="highlight-disclosure">Votre parcours peut figurer dans un Highlight public rédigé avec Mistral à partir de votre profil. Les champs de contact ne sont pas transmis ; évitez les coordonnées privées dans le parcours. <Link to="/confidentialite#highlights">En savoir plus</Link></p>}
              {error && <div className="form-status form-status--error" role="alert">{error}</div>}
              <Button type="submit" size="lg" disabled={busy}>{busy && <LoaderCircle className="spin" aria-hidden="true" />} Enregistrer et continuer</Button>
              <p className="account-form__login">Vous pourrez ajouter ou modifier votre photo depuis votre espace membre.</p>
            </form>
          )}
          <div className="account-form"><Button variant="ghost" onClick={() => void signOut()} disabled={busy}><LogOut size={16} aria-hidden="true" /> Se déconnecter</Button></div>
        </section>
      </div>
    </div>
  );
}
