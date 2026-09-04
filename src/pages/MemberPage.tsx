import { ArrowUpRight, Camera, CheckCircle2, LoaderCircle, LogOut, Network, PencilLine, UserRound } from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, ButtonLink } from "../components/ui/Button";
import {
  getAvatarValidationError,
  uploadAvatar,
  uploadPendingAvatar,
} from "../lib/avatarRepository";
import { supabase } from "../lib/supabase";

type PhotoStatus = {
  kind: "idle" | "loading" | "success" | "error";
  message?: string;
};

type MemberIdentity = {
  firstName: string;
  lastName: string;
  memberRole: "alumni" | "student";
};

export function MemberPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string>();
  const [identity, setIdentity] = useState<MemberIdentity>();
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>({ kind: "idle" });
  const userId = user?.id;

  useEffect(() => {
    const client = supabase;
    if (!client || !userId) return;
    let active = true;

    const loadPhoto = async () => {
      const { data } = await client
        .from("profiles")
        .select("first_name, last_name, member_role, photo_url")
        .eq("id", userId)
        .maybeSingle();
      if (active && data) {
        if (typeof data.photo_url === "string") setPhotoUrl(data.photo_url);
        if (
          typeof data.first_name === "string"
          && typeof data.last_name === "string"
          && (data.member_role === "alumni" || data.member_role === "student")
        ) {
          setIdentity({
            firstName: data.first_name,
            lastName: data.last_name,
            memberRole: data.member_role,
          });
        }
      }

      try {
        const pendingPhotoUrl = await uploadPendingAvatar({ id: userId, email: user.email });
        if (active && pendingPhotoUrl) {
          setPhotoUrl(pendingPhotoUrl);
          setPhotoStatus({ kind: "success", message: "Photo de profil enregistrée." });
        }
      } catch (error) {
        if (active) {
          setPhotoStatus({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "La photo doit être sélectionnée à nouveau.",
          });
        }
      }
    };

    void loadPhoto();

    return () => {
      active = false;
    };
  }, [user?.email, userId]);

  if (!user) return null;

  const metadata = user.user_metadata;
  const firstName = identity?.firstName
    ?? (typeof metadata.first_name === "string" ? metadata.first_name : "Membre");
  const lastName = identity?.lastName
    ?? (typeof metadata.last_name === "string" ? metadata.last_name : "LSNB");
  const role = (identity?.memberRole ?? metadata.member_role) === "student" ? "Élève" : "Alumni";
  const confirmed = searchParams.get("confirmed") === "true";
  const confirmedPhoto = searchParams.get("photo") === "uploaded";
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validationError = getAvatarValidationError(file);
    if (validationError) {
      setPhotoStatus({ kind: "error", message: validationError });
      return;
    }

    setPhotoStatus({ kind: "loading", message: "Enregistrement de la photo…" });
    try {
      const nextPhotoUrl = await uploadAvatar(user.id, file);
      setPhotoUrl(nextPhotoUrl);
      setPhotoStatus({ kind: "success", message: "Photo de profil enregistrée." });
    } catch (error) {
      setPhotoStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Impossible d’enregistrer cette photo.",
      });
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setIsSigningOut(true);
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="member-page">
      <div className="page-shell member-page__grid">
        <section className="member-page__intro">
          <p className="eyebrow">Espace membre</p>
          <h1>Bonjour,<br />{firstName}.</h1>
          <p>
            Votre session est active. Vous pouvez maintenant parcourir l’annuaire et consulter les profils du réseau.
          </p>
          <div className="member-page__actions">
            <ButtonLink to="/annuaire" size="lg">
              Explorer l’annuaire <ArrowUpRight aria-hidden="true" />
            </ButtonLink>
            <ButtonLink to={`/alumni/${user.id}`} size="lg" variant="outline">
              Voir mon profil
            </ButtonLink>
            <ButtonLink to="/espace/modifier" size="lg" variant="outline">
              <PencilLine aria-hidden="true" /> Modifier mon profil
            </ButtonLink>
          </div>
        </section>

        <aside className="member-card">
          {confirmed && (
            <div className="member-card__confirmed" role="status">
              <CheckCircle2 aria-hidden="true" />
              {confirmedPhoto
                ? "Adresse confirmée et photo enregistrée. Bienvenue dans le réseau."
                : "Adresse confirmée, bienvenue dans le réseau."}
            </div>
          )}
          <div className="member-card__identity">
            <span className="member-card__avatar">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt=""
                  onError={() => {
                    setPhotoUrl(undefined);
                    setPhotoStatus({
                      kind: "error",
                      message: "La photo enregistrée n’est plus accessible. Sélectionnez-la à nouveau.",
                    });
                  }}
                />
              ) : (
                <b>{initials || <UserRound aria-hidden="true" />}</b>
              )}
            </span>
            <div>
              <p>{role}</p>
              <h2>{firstName} {lastName}</h2>
              <span>{user.email}</span>
            </div>
          </div>
          <label className="member-card__photo">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handlePhoto}
              disabled={photoStatus.kind === "loading"}
            />
            {photoStatus.kind === "loading" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}
            <span>
              <b>{photoUrl ? "Remplacer ma photo" : "Ajouter ma photo"}</b>
              {photoStatus.message ?? "PNG, JPG ou WebP · 4 Mo max."}
            </span>
          </label>
          <div className="member-card__status">
            <Network aria-hidden="true" />
            <span><b>Compte connecté</b>Votre accès membre est opérationnel.</span>
          </div>
          <Button variant="ghost" onClick={handleSignOut} disabled={isSigningOut}>
            <LogOut aria-hidden="true" />
            {isSigningOut ? "Déconnexion…" : "Se déconnecter"}
          </Button>
        </aside>
      </div>
    </div>
  );
}
