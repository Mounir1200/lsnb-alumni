import { ArrowUpRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import type { AlumniProfile } from "../../data/alumni";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";

type AlumniCardProps = {
  profile: AlumniProfile;
  featured?: boolean;
};

export function AlumniCard({ profile, featured = false }: AlumniCardProps) {
  const fullName = `${profile.firstName} ${profile.lastName}`;
  const location = [profile.city, profile.country].filter(Boolean).join(", ");
  const specialties = [...new Set(profile.specialties)]
    .filter((item) => item && item !== profile.currentRole && item !== profile.domain)
    .slice(0, 2);

  return (
    <article className={cn(
      "alumni-card",
      featured && "alumni-card--featured",
      profile.photoUrl && "alumni-card--with-photo",
    )}>
      <Link className="alumni-card__link" to={`/alumni/${profile.id}`} aria-label={`Voir le profil de ${fullName}`}>
        <div className="alumni-card__media">
          <Avatar
            initials={profile.initials}
            avatarTone={profile.avatarTone}
            photoUrl={profile.photoUrl}
            className="alumni-card__avatar"
            loading="lazy"
            label={`${profile.isDemo === false ? "Photo" : "Portrait fictif"} de ${fullName}`}
          />
          {profile.graduationYear > 0 && <span className="alumni-card__promotion">Promo {profile.graduationYear}</span>}
        </div>

        <div className="alumni-card__body">
          <div className="alumni-card__identity">
            {profile.domain && profile.domain !== profile.currentRole && <p className="alumni-card__domain">{profile.domain}</p>}
            <h3>{fullName}</h3>
            <p className="alumni-card__role">{profile.currentRole}</p>
            {(location || profile.graduationYear > 0) && (
              <p className="alumni-card__location">
                {location && <><MapPin size={14} aria-hidden="true" /><span>{location}</span></>}
                {profile.graduationYear > 0 && <span className="alumni-card__inline-promotion">Promo {profile.graduationYear}</span>}
              </p>
            )}
          </div>
          {specialties.length > 0 && <ul className="alumni-card__specialties" aria-label="Spécialités">{specialties.map((item) => <li key={item}>{item}</li>)}</ul>}
        </div>

        <div className="alumni-card__footer">
          <span className="alumni-card__invitation">
            {profile.offersMentoring ? <span className="alumni-card__mentor"><i aria-hidden="true" /> Mentorat ouvert</span> : <span>Découvrir son parcours</span>}
            <b>Voir le profil</b>
          </span>
          <span className="alumni-card__arrow"><ArrowUpRight size={19} aria-hidden="true" /></span>
        </div>
      </Link>
    </article>
  );
}
