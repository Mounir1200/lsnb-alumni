import {
  ArrowLeft,
  Camera,
  Check,
  LoaderCircle,
  LockKeyhole,
  Orbit,
  Save,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, ButtonLink } from "../components/ui/Button";
import {
  deleteAvatar,
  getAvatarValidationError,
  uploadAvatar,
} from "../lib/avatarRepository";
import {
  loadEditableProfile,
  updateEditableProfile,
  type EditableProfile,
  type ProfileGender,
} from "../lib/profileRepository";

type EditorForm = {
  firstName: string;
  lastName: string;
  memberRole: "alumni" | "student";
  gender: ProfileGender;
  graduationYear: string;
  specialty: string;
  domain: string;
  specialties: string;
  city: string;
  country: string;
  experience: string;
  offersMentoring: boolean;
  mentoringTopics: string;
  contactVisible: boolean;
};

type SaveStatus = {
  kind: "idle" | "loading" | "success" | "warning" | "error";
  message?: string;
};

function toEditorForm(profile: EditableProfile): EditorForm {
  const mainSpecialty = profile.specialty.trim().toLocaleLowerCase("fr");
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    memberRole: profile.memberRole,
    gender: profile.gender,
    graduationYear: String(profile.graduationYear),
    specialty: profile.specialty,
    domain: profile.domain,
    specialties: profile.specialties
      .filter((value) => value.trim().toLocaleLowerCase("fr") !== mainSpecialty)
      .join(", "),
    city: profile.city,
    country: profile.country,
    experience: profile.experience,
    offersMentoring: profile.offersMentoring,
    mentoringTopics: profile.mentoringTopics.join("\n"),
    contactVisible: profile.contactVisible,
  };
}

function parseList(value: string) {
  return [...new Set(
    value
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export function EditProfilePage() {
  const { user } = useAuth();
  const [form, setForm] = useState<EditorForm>();
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string>();
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>();
  const [removePhoto, setRemovePhoto] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    if (!user) return;
    let active = true;
    setIsLoading(true);
    setLoadError(undefined);

    void loadEditableProfile(user.id)
      .then((profile) => {
        if (!active) return;
        setForm(toEditorForm(profile));
        setCurrentPhotoUrl(profile.photoUrl);
        setPhoto(null);
        setRemovePhoto(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : "Impossible de charger votre profil.",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey, user?.id]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(undefined);
      return;
    }
    const preview = URL.createObjectURL(photo);
    setPhotoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [photo]);

  if (!user) return null;

  const updateField = <Key extends keyof EditorForm>(key: Key, value: EditorForm[Key]) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
    setStatus({ kind: "idle" });
  };

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validationError = getAvatarValidationError(file);
    if (validationError) {
      setStatus({ kind: "error", message: validationError });
      return;
    }

    setPhoto(file);
    setRemovePhoto(false);
    setStatus({ kind: "idle" });
  };

  const handlePhotoSecondaryAction = () => {
    if (photo) {
      setPhoto(null);
      setStatus({ kind: "idle" });
      return;
    }
    setRemovePhoto((value) => !value);
    setStatus({ kind: "idle" });
  };

  const handleStoredPhotoError = () => {
    if (photoPreview) return;
    setCurrentPhotoUrl(undefined);
    setRemovePhoto(false);
    setStatus({
      kind: "warning",
      message: "La photo enregistrée n’est plus accessible. Vous pouvez en sélectionner une nouvelle.",
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;

    setStatus({ kind: "loading", message: "Enregistrement de vos modifications…" });

    try {
      const result = await updateEditableProfile(user.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        memberRole: form.memberRole,
        gender: form.gender,
        graduationYear: Number(form.graduationYear),
        specialty: form.specialty,
        domain: form.domain,
        specialties: parseList(form.specialties),
        city: form.city,
        country: form.country,
        experience: form.experience,
        offersMentoring: form.memberRole === "alumni" && form.offersMentoring,
        mentoringTopics: parseList(form.mentoringTopics),
        contactVisible: form.contactVisible,
        email: user.email ?? "",
      });

      let nextPhotoUrl = currentPhotoUrl;
      let photoWarning: string | undefined;
      try {
        if (photo) {
          nextPhotoUrl = await uploadAvatar(user.id, photo);
        } else if (removePhoto && currentPhotoUrl) {
          await deleteAvatar(user.id);
          nextPhotoUrl = undefined;
        }
      } catch (error) {
        photoWarning = error instanceof Error
          ? `La photo n’a pas été modifiée : ${error.message}`
          : "La photo n’a pas pu être modifiée.";
      }

      setCurrentPhotoUrl(nextPhotoUrl);
      setPhoto(null);
      setRemovePhoto(false);

      const warning = [result.warning, photoWarning].filter(Boolean).join(" ");
      setStatus(
        warning
          ? { kind: "warning", message: warning }
          : { kind: "success", message: "Votre profil est à jour dans l’annuaire." },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Impossible d’enregistrer vos modifications.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="auth-state-page" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Chargement de votre profil…</p>
      </div>
    );
  }

  if (loadError || !form) {
    return (
      <div className="auth-state-page">
        <UserRound aria-hidden="true" />
        <h1>Votre profil ne s’est pas ouvert.</h1>
        <p role="alert">{loadError ?? "Une erreur inattendue est survenue."}</p>
        <Button onClick={() => setReloadKey((value) => value + 1)}>Réessayer</Button>
      </div>
    );
  }

  const visiblePhotoUrl = photoPreview ?? (!removePhoto ? currentPhotoUrl : undefined);
  const initials = `${form.firstName[0] ?? ""}${form.lastName[0] ?? ""}`.toUpperCase();
  const roleLabel = form.memberRole === "alumni" ? "Alumni" : "Élève";

  return (
    <div className="account-page profile-editor-page">
      <div className="page-shell account-page__grid profile-editor-page__grid">
        <aside className="account-story profile-editor-story">
          <Link to="/espace" className="back-link">
            <ArrowLeft size={17} aria-hidden="true" /> Retour à mon espace
          </Link>
          <p className="eyebrow eyebrow--dark">Profil personnel</p>
          <h1>Un parcours vivant reste à jour.</h1>
          <p>
            Ajustez les informations qui aident les élèves et les autres alumni à comprendre
            votre trajectoire et à vous contacter au bon moment.
          </p>

          <div className="profile-editor-preview" aria-label="Aperçu de votre identité">
            <span className="profile-editor-preview__avatar">
              {visiblePhotoUrl ? (
                <img src={visiblePhotoUrl} alt="" onError={handleStoredPhotoError} />
              ) : initials ? (
                <b>{initials}</b>
              ) : (
                <UserRound aria-hidden="true" />
              )}
            </span>
            <div>
              <p>{form.domain || form.specialty || roleLabel}</p>
              <h2>{form.firstName || "Votre prénom"} {form.lastName || "Votre nom"}</h2>
              <span>{form.city || "Ville"}, {form.country || "pays"}</span>
            </div>
            <small>Aperçu de l’identité publique</small>
          </div>
        </aside>

        <section className="account-form-wrap" aria-labelledby="edit-profile-title">
          <div className="account-form-wrap__header">
            <p id="edit-profile-title">Modifier mon profil</p>
            <span>Visible dans l’annuaire</span>
          </div>

          <form className="account-form" onSubmit={handleSubmit}>
            <fieldset className="role-picker">
              <legend>Mon statut dans le réseau</legend>
              <label className={form.memberRole === "alumni" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="role"
                  value="alumni"
                  checked={form.memberRole === "alumni"}
                  onChange={() => updateField("memberRole", "alumni")}
                />
                <b>Alumni</b>
                <span>Ancien·ne élève du LSNB</span>
              </label>
              <label className={form.memberRole === "student" ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="role"
                  value="student"
                  checked={form.memberRole === "student"}
                  onChange={() => {
                    updateField("memberRole", "student");
                    updateField("offersMentoring", false);
                  }}
                />
                <b>Élève</b>
                <span>Actuellement au LSNB</span>
              </label>
            </fieldset>

            <label className="field-group">
              <span>Genre (facultatif)</span>
              <select
                value={form.gender}
                onChange={(event) => updateField("gender", event.target.value as ProfileGender)}
                aria-describedby="edit-gender-help"
              >
                <option value="unspecified">Je préfère ne pas préciser</option>
                <option value="female">Femme</option>
                <option value="male">Homme</option>
              </select>
              <small id="edit-gender-help">Cette information déclarée sert à équilibrer les duos Highlight. Elle n’est jamais déduite de votre nom ou de votre photo.</small>
            </label>

            <div className="form-row">
              <label className="field-group">
                <span>Prénom</span>
                <input
                  value={form.firstName}
                  onChange={(event) => updateField("firstName", event.target.value)}
                  autoComplete="given-name"
                  required
                />
              </label>
              <label className="field-group">
                <span>Nom</span>
                <input
                  value={form.lastName}
                  onChange={(event) => updateField("lastName", event.target.value)}
                  autoComplete="family-name"
                  required
                />
              </label>
            </div>

            <div className="form-row">
              <label className="field-group">
                <span>{form.memberRole === "alumni" ? "Année du bac" : "Année prévue du bac"}</span>
                <input
                  type="number"
                  min="2017"
                  max="2040"
                  value={form.graduationYear}
                  onChange={(event) => updateField("graduationYear", event.target.value)}
                  required
                />
              </label>
              <label className="field-group">
                <span>Domaine d’activité</span>
                <input
                  value={form.domain}
                  onChange={(event) => updateField("domain", event.target.value)}
                  placeholder="Ex. Technologies numériques"
                  required
                />
              </label>
            </div>

            <label className="field-group">
              <span>Spécialité principale</span>
              <input
                value={form.specialty}
                onChange={(event) => updateField("specialty", event.target.value)}
                placeholder="Ex. intelligence artificielle"
                required
              />
            </label>

            <label className="field-group">
              <span>Autres spécialités</span>
              <input
                value={form.specialties}
                onChange={(event) => updateField("specialties", event.target.value)}
                placeholder="Ex. data science, machine learning"
              />
              <small>Séparez les spécialités par une virgule.</small>
            </label>

            <div className="form-row">
              <label className="field-group">
                <span>Ville</span>
                <input
                  value={form.city}
                  onChange={(event) => updateField("city", event.target.value)}
                  autoComplete="address-level2"
                  required
                />
              </label>
              <label className="field-group">
                <span>Pays</span>
                <input
                  value={form.country}
                  onChange={(event) => updateField("country", event.target.value)}
                  autoComplete="country-name"
                  required
                />
              </label>
            </div>

            <label className="field-group">
              <span>Parcours et expériences</span>
              <textarea
                rows={7}
                value={form.experience}
                onChange={(event) => updateField("experience", event.target.value)}
                placeholder="Études, transitions, activité actuelle et repères que vous pouvez partager."
                required
              />
            </label>

            <div className="profile-editor-photo">
              <div className="profile-editor-photo__visual" aria-hidden="true">
                {visiblePhotoUrl ? (
                  <img src={visiblePhotoUrl} alt="" onError={handleStoredPhotoError} />
                ) : initials ? (
                  <b>{initials}</b>
                ) : (
                  <UserRound />
                )}
              </div>
              <div className="profile-editor-photo__copy">
                <b>Photo de profil</b>
                <span>{photo ? photo.name : "PNG, JPG ou WebP · 4 Mo max."}</span>
                {removePhoto && <small>La photo sera supprimée à l’enregistrement.</small>}
              </div>
              <div className="profile-editor-photo__actions">
                <label className="profile-editor-photo__upload">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handlePhoto}
                    disabled={status.kind === "loading"}
                  />
                  <Camera aria-hidden="true" />
                  {currentPhotoUrl || photo ? "Remplacer" : "Ajouter"}
                </label>
                {(currentPhotoUrl || photo) && (
                  <Button
                    variant="ghost"
                    className="profile-editor-photo__secondary"
                    onClick={handlePhotoSecondaryAction}
                    disabled={status.kind === "loading"}
                  >
                    {photo || removePhoto ? <Undo2 aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                    {photo ? "Annuler" : removePhoto ? "Conserver" : "Supprimer"}
                  </Button>
                )}
              </div>
            </div>

            {form.memberRole === "alumni" && (
              <div className="profile-editor-mentoring">
                <label className="form-check form-check--mentor">
                  <input
                    type="checkbox"
                    checked={form.offersMentoring}
                    onChange={(event) => updateField("offersMentoring", event.target.checked)}
                  />
                  <Orbit aria-hidden="true" />
                  <span>
                    <b>Je propose du mentorat</b>
                    Je reste libre d’accepter ou de refuser chaque demande.
                  </span>
                </label>
                {form.offersMentoring && (
                  <label className="field-group profile-editor-mentoring__topics">
                    <span>Sujets sur lesquels je peux aider</span>
                    <textarea
                      rows={4}
                      value={form.mentoringTopics}
                      onChange={(event) => updateField("mentoringTopics", event.target.value)}
                      placeholder={"Orientation\nCandidatures\nMéthodes de travail"}
                    />
                    <small>Un sujet par ligne, ou séparés par des virgules.</small>
                  </label>
                )}
              </div>
            )}

            <label className="form-check">
              <input
                type="checkbox"
                checked={form.contactVisible}
                onChange={(event) => updateField("contactVisible", event.target.checked)}
              />
              <LockKeyhole aria-hidden="true" />
              <span>
                <b>Rendre mon e-mail visible aux membres connectés</b>
                Désactivez ce choix pour être contacté uniquement par les demandes du site.
              </span>
            </label>

            <label className="field-group">
              <span>Adresse e-mail du compte</span>
              <input value={user.email ?? ""} readOnly aria-readonly="true" />
              <small>L’adresse de connexion ne se modifie pas depuis le profil.</small>
            </label>

            {status.kind !== "idle" && status.message && (
              <div className={`form-status form-status--${status.kind}`} role="status">
                {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
                {status.kind === "success" && <Check aria-hidden="true" />}
                {status.message}
                {status.kind === "success" && (
                  <Link to={`/alumni/${user.id}`}>Voir mon profil</Link>
                )}
              </div>
            )}

            <div className="profile-editor-actions">
              <ButtonLink to="/espace" size="lg" variant="outline">Annuler</ButtonLink>
              <Button type="submit" size="lg" disabled={status.kind === "loading"}>
                <Save aria-hidden="true" />
                {status.kind === "loading" ? "Enregistrement…" : "Enregistrer les modifications"}
              </Button>
            </div>

            {form.memberRole === "alumni" && (
              <p className="highlight-disclosure">
                Votre parcours peut être mis à l’honneur dans un Highlight visible par tous,
                sans connexion. Les informations de votre parcours sont alors transmises à
                Mistral pour rédiger le portrait. Les champs de contact ne sont pas transmis ;
                évitez d’ajouter des coordonnées privées dans le texte de votre parcours.
                {" "}<Link to="/confidentialite#highlights">En savoir plus</Link>
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
