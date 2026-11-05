import type { AlumniProfile } from "../data/alumni";
import { alumniProfiles } from "../data/alumni";
import { isSupabaseConfigured, supabase } from "./supabase";
import { parseCareerSteps, toCareerStepRows, type CareerStep } from "./careerSteps";
import { mapProfile, type ProfileGender, type ProfileRow } from "./profileMapping";
import { mapPublicProfile, type PublicProfileRow } from "./publicProfiles";
import { normalizeProfileLink } from "./profileLinks";

export type { ProfileGender } from "./profileMapping";

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
  linkedinUrl?: string;
  portfolioUrl?: string;
  offersMentoring: boolean;
  mentoringTopics: string[];
  careerSteps: CareerStep[];
  contactVisible: boolean;
  /** Alumni only: shown in the directory that visitors see without an account. */
  listedPublicly: boolean;
};

export type EditableProfileUpdate = Omit<EditableProfile, "photoUrl"> & {
  email: string;
};

type UpdateProfileResult = {
  warning?: string;
};

export async function loadProfiles() {
  if (!supabase || !isSupabaseConfigured) {
    return { profiles: alumniProfiles, source: "demo" as const };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, member_role, graduation_year, specialty, specialties, domain, city, country, experience, photo_url, linkedin_url, portfolio_url, offers_mentoring, mentoring_topics, career_steps",
    )
    .eq("is_active", true)
    .order("last_name");

  if (error) throw error;
  return { profiles: (data as ProfileRow[]).map(mapProfile), source: "supabase" as const };
}

/** Visitors' directory: alumni who stay listed, with only what a card shows. */
export async function loadPublicProfiles() {
  if (!supabase || !isSupabaseConfigured) {
    return { profiles: alumniProfiles, source: "demo" as const };
  }
  const { data, error } = await supabase.rpc("public_directory_profiles");
  if (error) throw error;
  return { profiles: (data as PublicProfileRow[]).map(mapPublicProfile), source: "public" as const };
}

export async function loadProfile(id: string) {
  if (!supabase || !isSupabaseConfigured) return undefined;

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, first_name, last_name, member_role, graduation_year, specialty, specialties, domain, city, country, experience, photo_url, linkedin_url, portfolio_url, offers_mentoring, mentoring_topics, career_steps",
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
        "id, first_name, last_name, member_role, gender, graduation_year, specialty, specialties, domain, city, country, experience, photo_url, linkedin_url, portfolio_url, offers_mentoring, mentoring_topics, career_steps, listed_publicly",
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

  const row = profileResult.data as ProfileRow & { listed_publicly: boolean };
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
    linkedinUrl: row.linkedin_url ?? undefined,
    portfolioUrl: row.portfolio_url ?? undefined,
    offersMentoring: row.offers_mentoring,
    mentoringTopics: row.mentoring_topics?.filter(Boolean) ?? [],
    careerSteps: parseCareerSteps(row.career_steps),
    contactVisible: contactResult.data?.is_visible === true,
    listedPublicly: row.listed_publicly,
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
  const linkedinUrl = normalizeProfileLink(profile.linkedinUrl, "linkedin");
  const portfolioUrl = normalizeProfileLink(profile.portfolioUrl, "portfolio");

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
      linkedin_url: linkedinUrl,
      portfolio_url: portfolioUrl,
      offers_mentoring: offersMentoring,
      mentoring_topics: mentoringTopics,
      career_steps: toCareerStepRows(profile.careerSteps),
      listed_publicly: profile.listedPublicly,
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
      linkedin_url: linkedinUrl,
      portfolio_url: portfolioUrl,
      offers_mentoring: offersMentoring,
      contact_visible: profile.contactVisible,
    },
  });

  if (metadataError) warnings.push("les informations de session n’ont pas été synchronisées");

  return warnings.length
    ? { warning: `Le profil est enregistré, mais ${warnings.join(" et ")}.` }
    : {};
}
