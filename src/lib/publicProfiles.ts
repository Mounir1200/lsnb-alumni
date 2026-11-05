import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlumniProfile } from "../data/alumni";
import { mapProfile, type ProfileRow } from "./profileMapping";

/** What public.public_directory_profiles() returns to visitors: a directory card, nothing more. */
export type PublicProfileRow = Pick<ProfileRow,
  "id" | "first_name" | "last_name" | "member_role" | "graduation_year" | "specialty" | "specialties"
  | "domain" | "city" | "country" | "photo_url" | "offers_mentoring">;

export function mapPublicProfile(row: PublicProfileRow): AlumniProfile {
  return mapProfile({
    ...row, experience: "", linkedin_url: null, portfolio_url: null, mentoring_topics: [], career_steps: [],
  });
}

/** The visitors' directory, read through the one function open to them. */
export async function fetchPublicProfiles(client: Pick<SupabaseClient, "rpc">): Promise<AlumniProfile[]> {
  const { data, error } = await client.rpc("public_directory_profiles");
  if (error) throw error;
  return (data as PublicProfileRow[]).map(mapPublicProfile);
}
