import { ArrowUpRight, BookOpen, Globe, Linkedin, Orbit } from "lucide-react";
import type { AlumniProfile } from "../../data/alumni";

/** What a visitor needs while reading: what the member can share, where to find them, their fields. */
export function ProfileAside({ profile }: { profile: AlumniProfile }) {
  return (
    <aside className="profile-aside">
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

      {(profile.linkedinUrl || profile.portfolioUrl) && (
        <section className="profile-links" aria-label="Liens du profil">
          <p>Retrouver {profile.firstName}</p>
          {profile.linkedinUrl && (
            <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer">
              <Linkedin size={18} aria-hidden="true" />
              <span>Profil LinkedIn</span>
              <ArrowUpRight size={16} aria-hidden="true" />
              <span className="sr-only"> (nouvel onglet)</span>
            </a>
          )}
          {profile.portfolioUrl && (
            <a href={profile.portfolioUrl} target="_blank" rel="noopener noreferrer">
              <Globe size={18} aria-hidden="true" />
              <span>Portfolio</span>
              <ArrowUpRight size={16} aria-hidden="true" />
              <span className="sr-only"> (nouvel onglet)</span>
            </a>
          )}
        </section>
      )}

      <section>
        <p>Spécialités</p>
        <div className="specialty-list">
          {profile.specialties.map((specialty) => <span key={specialty}>{specialty}</span>)}
        </div>
      </section>

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
  );
}
