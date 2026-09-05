import type { AlumniProfile } from "../data/alumni";
import { alumniProfiles } from "../data/alumni";
import { isSupabaseConfigured, supabase } from "./supabase";

export type ProfileGender = "male" | "female" | "unspecified";

type ProfileRow = {
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
  offers_mentoring: boolean;
  mentoring_topics: string[] | null;
};

export type EditableProfile = {
  firstName: string;
  lastName: string;
  memberRole: "alumni" | "student";
  gender: ProfileGender;
  graduationYear: number;
  specialty: string;
  domain: string;
  specialties: string[];
  city: string;
  country: string;
  experience: string;
  photoUrl?: string;
  offersMentoring: boolean;
  mentoringTopics: string[];
  contactVisible: boolean;
};

export type EditableProfileUpdate = Omit<EditableProfile, "photoUrl"> & {
  email: string;
};

type UpdateProfileResult = {
  warning?: string;
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

export async function loadEditableProfile(id: string): Promise<EditableProfile> {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error("Supabase n’est pas configuré.");
  }

  const [profileResult, contactResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, first_name, last_name, member_role, gender, graduation_year, specialty, specialties, domain, city, country, experience, photo_url, offers_mentoring, mentoring_topics",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("profile_contacts")
      .select("is_visible")
      .eq("profile_id", id)
      .maybeSingle(),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (contactResult.error) throw contactResult.error;
  if (!profileResult.data) throw new Error("Votre profil est introuvable.");

  const row = profileResult.data as ProfileRow;
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    memberRole: row.member_role,
    gender: row.gender ?? "unspecified",
    graduationYear: row.graduation_year ?? new Date().getFullYear(),
    specialty: row.specialty,
    domain: row.domain ?? row.specialty,
    specialties: row.specialties?.filter(Boolean) ?? [],
    city: row.city ?? "",
    country: row.country ?? "",
    experience: row.experience,
    photoUrl: row.photo_url ?? undefined,
    offersMentoring: row.offers_mentoring,
    mentoringTopics: row.mentoring_topics?.filter(Boolean) ?? [],
    contactVisible: contactResult.data?.is_visible === true,
  };
}

export async function updateEditableProfile(
  id: string,
  profile: EditableProfileUpdate,
): Promise<UpdateProfileResult> {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error("Supabase n’est pas configuré.");
  }

  const specialties = [...new Set(
    [profile.specialty, ...profile.specialties]
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  const mentoringTopics = profile.memberRole === "alumni" && profile.offersMentoring
    ? [...new Set(profile.mentoringTopics.map((value) => value.trim()).filter(Boolean))]
    : [];
  const offersMentoring = profile.memberRole === "alumni" && profile.offersMentoring;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      first_name: profile.firstName.trim(),
      last_name: profile.lastName.trim(),
      member_role: profile.memberRole,
      gender: profile.gender,
      graduation_year: profile.graduationYear,
      specialty: profile.specialty.trim(),
      specialties,
      domain: profile.domain.trim() || null,
      city: profile.city.trim() || null,
      country: profile.country.trim() || null,
      experience: profile.experience.trim(),
      offers_mentoring: offersMentoring,
      mentoring_topics: mentoringTopics,
    })
    .eq("id", id)
    .select("id")
    .single();

  if (profileError) throw profileError;

  const warnings: string[] = [];
  const { error: contactError } = await supabase
    .from("profile_contacts")
    .upsert(
      {
        profile_id: id,
        email: profile.email,
        is_visible: profile.contactVisible,
      },
      { onConflict: "profile_id" },
    );

  if (contactError) warnings.push("la visibilité du contact n’a pas été mise à jour");

  const { error: metadataError } = await supabase.auth.updateUser({
    data: {
      first_name: profile.firstName.trim(),
      last_name: profile.lastName.trim(),
      member_role: profile.memberRole,
      gender: profile.gender,
      graduation_year: profile.graduationYear,
      specialty: profile.specialty.trim(),
      city: profile.city.trim(),
      country: profile.country.trim(),
      experience: profile.experience.trim(),
      offers_mentoring: offersMentoring,
      contact_visible: profile.contactVisible,
    },
  });

  if (metadataError) warnings.push("les informations de session n’ont pas été synchronisées");

  return warnings.length
    ? { warning: `Le profil est enregistré, mais ${warnings.join(" et ")}.` }
    : {};
}
