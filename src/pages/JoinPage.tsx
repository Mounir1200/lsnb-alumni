import { Camera, Check, LoaderCircle, LockKeyhole, Orbit, UserRound } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { getAuthCallbackUrl } from "../lib/auth";
import { getAvatarValidationError, uploadAvatar } from "../lib/avatarRepository";
import { savePendingAvatar } from "../lib/pendingAvatarStore";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type SubmissionStatus = {
  kind: "idle" | "loading" | "success" | "error";
  message?: string;
};

export function JoinPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [role, setRole] = useState<"alumni" | "student">("alumni");
  const [offersMentoring, setOffersMentoring] = useState(searchParams.get("mentorat") === "true");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>();
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle" });

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(undefined);
      return;
    }
    const preview = URL.createObjectURL(photo);
    setPhotoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [photo]);

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const validationError = file ? getAvatarValidationError(file) : null;
    if (validationError) {
      setStatus({ kind: "error", message: validationError });
      event.target.value = "";
      return;
    }
    setPhoto(file ?? null);
    setStatus({ kind: "idle" });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus({ kind: "loading" });

    const profile = {
      first_name: String(data.get("firstName") ?? "").trim(),
      last_name: String(data.get("lastName") ?? "").trim(),
      member_role: role,
      gender: String(data.get("gender") ?? "unspecified"),
      graduation_year: Number(data.get("graduationYear")),
      specialty: String(data.get("specialty") ?? "").trim(),
      country: String(data.get("country") ?? "").trim(),
      city: String(data.get("city") ?? "").trim(),
      experience: String(data.get("experience") ?? "").trim(),
      offers_mentoring: role === "alumni" && offersMentoring,
      contact_visible: data.get("contactVisible") === "on",
    };

    try {
      if (!supabase || !isSupabaseConfigured) {
        localStorage.setItem("lsnb-demo-profile", JSON.stringify(profile));
        setStatus({
          kind: "success",
          message: "Profil de démonstration enregistré dans ce navigateur. Connectez Supabase pour créer un vrai compte.",
        });
        form.reset();
        setPhoto(null);
        return;
      }

      const email = String(data.get("email") ?? "").trim();
      const password = String(data.get("password") ?? "");
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: profile,
          emailRedirectTo: getAuthCallbackUrl(),
        },
      });
      if (authError) throw authError;

      let photoQueued = false;
      if (photo && authData.user) {
        if (authData.session) {
          await uploadAvatar(authData.user.id, photo);
        } else {
          photoQueued = await savePendingAvatar(email, photo);
        }
      }

      let confirmationPhotoMessage = "";
      if (photo) {
        confirmationPhotoMessage = photoQueued
          ? " La photo sera ajoutée automatiquement si vous ouvrez le lien dans ce navigateur."
          : " Vous pourrez ajouter votre photo depuis votre espace membre après confirmation.";
      }

      setStatus({
        kind: "success",
        message: authData.session
          ? "Votre compte est créé. Bienvenue dans le réseau."
          : `Compte créé. Consultez votre boîte mail pour confirmer votre adresse.${confirmationPhotoMessage}`,
      });
      form.reset();
      setPhoto(null);
      if (authData.session) navigate("/espace?created=true", { replace: true });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Une erreur est survenue. Réessayez.",
      });
    }
  };

  return (
    <div className="account-page">
      <div className="page-shell account-page__grid">
        <aside className="account-story">
          <p className="eyebrow">Rejoindre le réseau</p>
          <h1>Votre parcours peut devenir le repère de quelqu’un.</h1>
          <p>
            Créez un profil utile et précis. Vous décidez quelles coordonnées sont visibles et
            si vous souhaitez recevoir des demandes de mentorat.
          </p>
          <div className="account-story__principles">
            <span><UserRound aria-hidden="true" /><b>Profils vérifiables</b>Nom, promotion et parcours.</span>
            <span><LockKeyhole aria-hidden="true" /><b>Contact maîtrisé</b>Visibilité choisie par le membre.</span>
            <span><Orbit aria-hidden="true" /><b>Mentorat volontaire</b>Jamais activé par défaut.</span>
          </div>
        </aside>

        <section className="account-form-wrap" aria-labelledby="join-title">
          <div className="account-form-wrap__header">
            <p id="join-title">Créer un compte</p>
            <span>{isSupabaseConfigured ? "Supabase connecté" : "Mode démonstration local"}</span>
          </div>

          <form className="account-form" onSubmit={handleSubmit}>
            <fieldset className="role-picker">
              <legend>Je suis</legend>
              <label className={role === "alumni" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="role"
                  value="alumni"
                  checked={role === "alumni"}
                  onChange={() => setRole("alumni")}
                />
                <b>Alumni</b>
                <span>Ancien·ne élève du LSNB</span>
              </label>
              <label className={role === "student" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="role"
                  value="student"
                  checked={role === "student"}
                  onChange={() => {
                    setRole("student");
                    setOffersMentoring(false);
                  }}
                />
                <b>Élève</b>
                <span>Actuellement au LSNB</span>
              </label>
            </fieldset>

            <div className="form-row">
              <label className="field-group"><span>Prénom</span><input name="firstName" autoComplete="given-name" required /></label>
              <label className="field-group"><span>Nom</span><input name="lastName" autoComplete="family-name" required /></label>
            </div>

            <label className="field-group">
              <span>Genre (facultatif)</span>
              <select name="gender" defaultValue="unspecified" aria-describedby="join-gender-help">
                <option value="unspecified">Je préfère ne pas préciser</option>
                <option value="female">Femme</option>
                <option value="male">Homme</option>
              </select>
              <small id="join-gender-help">Cette information déclarée sert à équilibrer les duos Highlight. Elle n’est jamais déduite de votre nom ou de votre photo.</small>
            </label>

            <div className="form-row">
              <label className="field-group">
                <span>{role === "alumni" ? "Année du bac" : "Année prévue du bac"}</span>
                <input name="graduationYear" type="number" min="2017" max="2040" required />
              </label>
              <label className="field-group"><span>Spécialité ou domaine</span><input name="specialty" placeholder="Ex. génie civil" required /></label>
            </div>

            <div className="form-row">
              <label className="field-group"><span>Ville</span><input name="city" autoComplete="address-level2" required /></label>
              <label className="field-group"><span>Pays</span><input name="country" autoComplete="country-name" required /></label>
            </div>

            <label className="field-group">
              <span>Parcours et expériences</span>
              <textarea
                name="experience"
                rows={5}
                placeholder="Études, transitions, activité actuelle et ce que vous aimeriez partager."
                required
              />
            </label>

            <label className="photo-upload">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto} />
              <span className="photo-upload__preview">
                {photoPreview ? <img src={photoPreview} alt="Aperçu de votre photo" /> : <Camera aria-hidden="true" />}
              </span>
              <span><b>{photo ? photo.name : "Ajouter une photo"}</b>PNG, JPG ou WebP · 4 Mo max.</span>
            </label>

            {role === "alumni" && (
              <label className="form-check form-check--mentor">
                <input
                  type="checkbox"
                  checked={offersMentoring}
                  onChange={(event) => setOffersMentoring(event.target.checked)}
                />
                <span><b>Je souhaite proposer du mentorat</b>Je pourrai accepter ou refuser chaque demande selon ma disponibilité.</span>
              </label>
            )}

            <label className="form-check">
              <input type="checkbox" name="contactVisible" />
              <span><b>Rendre mon contact visible aux membres</b>Ce choix peut être modifié plus tard.</span>
            </label>

            <div className="form-divider" />

            <label className="field-group"><span>Adresse e-mail</span><input name="email" type="email" autoComplete="email" required /></label>
            <label className="field-group">
              <span>Mot de passe</span>
              <input name="password" type="password" minLength={8} autoComplete="new-password" required />
              <small>8 caractères minimum.</small>
            </label>

            <label className="form-consent">
              <input type="checkbox" required />
              <span>J’accepte que ces informations soient utilisées pour mon profil LSNB Réseau. <Link to="/confidentialite">Voir la politique de confidentialité.</Link></span>
            </label>

            {role === "alumni" && (
              <p className="highlight-disclosure">
                Votre parcours peut être mis à l’honneur dans un Highlight visible par tous,
                sans connexion. Les informations de votre parcours sont alors transmises à
                Mistral pour rédiger le portrait. Les champs de contact ne sont pas transmis ;
                évitez d’ajouter des coordonnées privées dans le texte de votre parcours.
                {" "}<Link to="/confidentialite#highlights">En savoir plus</Link>
              </p>
            )}

            {status.kind !== "idle" && status.message && (
              <div className={`form-status form-status--${status.kind}`} role="status">
                {status.kind === "success" && <Check aria-hidden="true" />}
                {status.message}
              </div>
            )}

            <Button type="submit" size="lg" disabled={status.kind === "loading"}>
              {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
              Créer mon compte
            </Button>

            <p className="account-form__login">Déjà membre&nbsp;? <Link to="/connexion">Se connecter</Link></p>
          </form>
        </section>
      </div>
    </div>
  );
}
