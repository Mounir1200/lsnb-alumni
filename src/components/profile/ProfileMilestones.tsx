import type { AlumniProfile } from "../../data/alumni";

type Milestone = { key: string; label: string; title: string; detail?: string; tone?: "origin" | "now" };

function describeMilestones(profile: AlumniProfile): Milestone[] {
  const isStudent = profile.graduationYear > new Date().getFullYear();
  const milestones: Milestone[] = [{
    key: "lsnb",
    label: String(profile.graduationYear),
    title: isStudent ? "Baccalauréat scientifique (prévu)" : "Baccalauréat scientifique",
    detail: "LSNB · Bobo-Dioulasso",
    tone: "origin",
  }];
  profile.education.forEach((education) => milestones.push({ key: education, label: "Puis", title: education }));
  if (!isStudent) {
    milestones.push({
      key: "now",
      label: "Aujourd’hui",
      title: profile.currentRole,
      detail: [profile.organization, `${profile.city}, ${profile.country}`].filter(Boolean).join(" · "),
      tone: "now",
    });
  }
  return milestones;
}

/** The school, the known steps, then today: the same path as the hero globe. */
export function ProfileMilestones({ profile }: { profile: AlumniProfile }) {
  return (
    <section className="profile-milestones" aria-labelledby="profile-milestones-title">
      <h2 id="profile-milestones-title" className="profile-section-title">Repères</h2>
      <ol>
        {describeMilestones(profile).map((milestone) => (
          <li key={milestone.key} className={milestone.tone ? `is-${milestone.tone}` : undefined}>
            <span className="profile-milestones__label">{milestone.label}</span>
            <div>
              <b>{milestone.title}</b>
              {milestone.detail && <p>{milestone.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
