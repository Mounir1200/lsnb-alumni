import type { AlumniProfile } from "../../data/alumni";
import { isLsnbStep, isOngoingStep, type CareerStep } from "../../lib/careerSteps";

type Milestone = {
  key: string;
  label: string;
  note?: string;
  title: string;
  detail?: string;
  tone?: "origin" | "now";
};

function formatPeriod({ startYear, endYear }: CareerStep) {
  if (endYear === null) return `Depuis ${startYear}`;
  return endYear === startYear ? String(startYear) : `${startYear} – ${endYear}`;
}

function toMilestone(step: CareerStep, index: number): Milestone {
  const isOngoing = isOngoingStep(step);
  return {
    key: `${step.kind}-${index}`,
    label: formatPeriod(step),
    // "Depuis 2024" already says it; a closed period ending later needs the word.
    note: isOngoing && step.endYear !== null ? "En cours" : undefined,
    title: step.title,
    detail: [step.organization, step.location].filter(Boolean).join(" · ") || undefined,
    tone: isLsnbStep(step) ? "origin" : isOngoing ? "now" : undefined,
  };
}

function lsnbBaccalaureate(profile: AlumniProfile): Milestone {
  const isExpected = profile.graduationYear > new Date().getFullYear();
  return {
    key: "lsnb",
    label: String(profile.graduationYear),
    title: isExpected ? "Baccalauréat scientifique (prévu)" : "Baccalauréat scientifique",
    detail: "LSNB · Bobo-Dioulasso",
    tone: "origin",
  };
}

function Timeline({ id, title, milestones }: { id: string; title: string; milestones: Milestone[] }) {
  return (
    <section className="profile-milestones" aria-labelledby={id}>
      <h2 id={id} className="profile-section-title">{title}</h2>
      <ol>
        {milestones.map((milestone) => (
          <li key={milestone.key} className={milestone.tone ? `is-${milestone.tone}` : undefined}>
            <span className="profile-milestones__label">
              {milestone.label}
              {milestone.note && <small>{milestone.note}</small>}
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

/** Studies from the LSNB onwards, then work: each in time order, as on the hero globe. */
export function ProfileMilestones({ profile }: { profile: AlumniProfile }) {
  const studies = profile.careerSteps.filter((step) => step.kind === "education");
  const jobs = profile.careerSteps.filter((step) => step.kind === "work");
  const studyMilestones = studies.map(toMilestone);
  const formation = studies.some(isLsnbStep) ? studyMilestones : [lsnbBaccalaureate(profile), ...studyMilestones];

  return (
    <>
      <Timeline id="profile-formation-title" title="Formation" milestones={formation} />
      {jobs.length > 0 && (
        <Timeline id="profile-experience-title" title="Expériences professionnelles" milestones={jobs.map(toMilestone)} />
      )}
    </>
  );
}
