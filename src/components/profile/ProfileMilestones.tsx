import type { AlumniProfile } from "../../data/alumni";
import type { CareerStep, CareerStepKind } from "../../lib/careerSteps";

type Milestone = {
  key: string;
  label: string;
  kind?: string;
  title: string;
  detail?: string;
  tone?: "origin" | "now";
};

const kindLabels: Record<CareerStepKind, string> = { education: "Formation", work: "Expérience" };

function formatPeriod({ startYear, endYear }: CareerStep) {
  if (endYear === null) return `Depuis ${startYear}`;
  return endYear === startYear ? String(startYear) : `${startYear} – ${endYear}`;
}

function describeMilestones(profile: AlumniProfile): Milestone[] {
  const isStudent = profile.graduationYear > new Date().getFullYear();
  const milestones: Milestone[] = [{
    key: "lsnb",
    label: String(profile.graduationYear),
    title: isStudent ? "Baccalauréat scientifique (prévu)" : "Baccalauréat scientifique",
    detail: "LSNB · Bobo-Dioulasso",
    tone: "origin",
  }];
  profile.careerSteps.forEach((step, index) => milestones.push({
    key: `step-${index}`,
    label: formatPeriod(step),
    kind: kindLabels[step.kind],
    title: step.title,
    detail: [step.organization, step.location].filter(Boolean).join(" · ") || undefined,
    tone: step.endYear === null ? "now" : undefined,
  }));
  // Without an ongoing step, today is described by the profile's role and place.
  if (!isStudent && !profile.careerSteps.some((step) => step.endYear === null)) {
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

/** The school, the member's steps, then today: the same path as the hero globe. */
export function ProfileMilestones({ profile }: { profile: AlumniProfile }) {
  return (
    <section className="profile-milestones" aria-labelledby="profile-milestones-title">
      <h2 id="profile-milestones-title" className="profile-section-title">Repères</h2>
      <ol>
        {describeMilestones(profile).map((milestone) => (
          <li key={milestone.key} className={milestone.tone ? `is-${milestone.tone}` : undefined}>
            <span className="profile-milestones__label">
              {milestone.label}
              {milestone.kind && <small>{milestone.kind}</small>}
            </span>
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
