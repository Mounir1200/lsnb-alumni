import type { AlumniProfile } from "../data/alumni";
import { alumniProfiles } from "../data/alumni";
import { isSupabaseConfigured, supabase } from "./supabase";

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  member_role: "alumni" | "student";
  graduation_year: number | null;
  specialty: string;
  specialties: string[] | null;
  domain: string | null;
  city: string | null;
  country: string | null;
  experience: string;
  photo_url: string | null;
  offers_mentoring: boolean;
  mentoring_topics: string[] | null;
};

const avatarTones: AlumniProfile["avatarTone"][] = ["ochre", "green", "blue", "sand"];

function avatarToneFromId(id: string) {
  const checksum = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return avatarTones[checksum % avatarTones.length] ?? "sand";
}

function mapProfile(row: ProfileRow): AlumniProfile {
  const specialties = row.specialties?.filter(Boolean) ?? [];
  if (row.specialty && !specialties.includes(row.specialty)) specialties.unshift(row.specialty);

  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    graduationYear: row.graduation_year ?? new Date().getFullYear(),
    currentRole:
      row.member_role === "student"
        ? "Élève au LSNB"
        : row.specialty || row.domain || "Alumni du LSNB",
    organization: row.member_role === "student" ? "Lycée Scientifique National" : "",
    city: row.city || "Ville non renseignée",
    country: row.country || "Pays non renseigné",
    domain: row.domain || row.specialty || "Sciences",
    specialties: specialties.length ? specialties : ["Parcours scientifique"],
    education: [],
    experience: row.experience,
    offersMentoring: row.offers_mentoring,
    mentoringTopics: row.mentoring_topics?.filter(Boolean) ?? [],
    initials: `${row.first_name[0] ?? ""}${row.last_name[0] ?? ""}`.toUpperCase(),
    avatarTone: avatarToneFromId(row.id),
    photoUrl: row.photo_url ?? undefined,
    isDemo: false,
  };
}

export async function loadProfiles() {
  if (!supabase || !isSupabaseConfigured) {
    return { profiles: alumniProfiles, source: "demo" as const };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, member_role, graduation_year, specialty, specialties, domain, city, country, experience, photo_url, offers_mentoring, mentoring_topics",
    )
    .eq("is_active", true)
    .order("last_name");

  if (error) throw error;
  const profiles = (data as ProfileRow[]).map(mapProfile);
  return profiles.length
    ? { profiles, source: "supabase" as const }
    : { profiles: alumniProfiles, source: "demo" as const };
}

export async function loadProfile(id: string) {
  if (!supabase || !isSupabaseConfigured) return undefined;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, member_role, graduation_year, specialty, specialties, domain, city, country, experience, photo_url, offers_mentoring, mentoring_topics",
    )
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data ? mapProfile(data as ProfileRow) : undefined;
}
