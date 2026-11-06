import type { AlumniProfile } from "../data/alumni";
import { findCurrentJob, parseCareerSteps } from "./careerSteps";
import { getSafeProfileLink } from "./profileLinks";

export type ProfileGender = "male" | "female" | "unspecified";

/** A profiles row as the site reads it; kept free of the Supabase client so it can be tested. */
export type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  member_role: "alumni" | "student";
  gender?: ProfileGender | null;
  graduation_year: number | null;
  specialty: string;
  specialties: string[] | null;
  domain: string | null;
  city: string | null;
  country: string | null;
  experience: string;
  photo_url: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  offers_mentoring: boolean;
  mentoring_topics: string[] | null;
  career_steps: unknown;
};

const avatarTones: AlumniProfile["avatarTone"][] = ["ochre", "green", "blue", "sand"];

function avatarToneFromId(id: string) {
  const checksum = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return avatarTones[checksum % avatarTones.length] ?? "sand";
}

export function mapProfile(row: ProfileRow): AlumniProfile {
  const specialties = row.specialties?.filter(Boolean) ?? [];
  if (row.specialty && !specialties.includes(row.specialty)) specialties.unshift(row.specialty);
  const careerSteps = parseCareerSteps(row.career_steps);
  const currentJob = row.member_role === "alumni" ? findCurrentJob(careerSteps) : undefined;

  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    graduationYear: row.graduation_year ?? new Date().getFullYear(),
    currentRole:
      row.member_role === "student"
        ? "Élève au LSNB"
        : currentJob?.title || row.specialty || row.domain || "Alumni du LSNB",
    organization: row.member_role === "student" ? "Lycée Scientifique National" : currentJob?.organization ?? "",
    city: row.city || "Ville non renseignée",
    country: row.country || "Pays non renseigné",
    domain: row.domain || row.specialty || "Sciences",
    specialties: specialties.length ? specialties : ["Parcours scientifique"],
    careerSteps,
    experience: row.experience,
    offersMentoring: row.offers_mentoring,
    mentoringTopics: row.mentoring_topics?.filter(Boolean) ?? [],
    initials: `${row.first_name[0] ?? ""}${row.last_name[0] ?? ""}`.toUpperCase(),
    avatarTone: avatarToneFromId(row.id),
    photoUrl: row.photo_url ?? undefined,
    linkedinUrl: getSafeProfileLink(row.linkedin_url, "linkedin"),
    portfolioUrl: getSafeProfileLink(row.portfolio_url, "portfolio"),
    isDemo: false,
  };
}
