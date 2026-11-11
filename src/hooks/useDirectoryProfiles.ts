import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { alumniProfiles, type AlumniProfile } from "../data/alumni";
import { loadProfiles, loadPublicProfiles } from "../lib/profileRepository";
import { isSupabaseConfigured } from "../lib/supabase";

type DirectoryProfilesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; profiles: AlumniProfile[]; source: "demo" | "supabase" | "public" };

const demoDirectory: DirectoryProfilesState = { status: "ready", profiles: alumniProfiles, source: "demo" };

// Active members read every active profile; visitors, and accounts not yet
// approved, get the public alumni listing. The fictional showcase remains only
// for a site without Supabase.
export function useDirectoryProfiles() {
  const { user, isLoading: authLoading, memberStatus, profileError } = useAuth();
  const [state, setState] = useState<DirectoryProfilesState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const userId = user?.id;
  const showsDemo = !isSupabaseConfigured;
  const readsMembers = memberStatus === "active";
  const isCheckingMember = Boolean(userId) && memberStatus === null && !profileError;

  useEffect(() => {
    if (showsDemo || authLoading || isCheckingMember) return;
    let active = true;
    setState({ status: "loading" });
    (readsMembers ? loadProfiles() : loadPublicProfiles())
      .then((result) => { if (active) setState({ status: "ready", ...result }); })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [showsDemo, authLoading, isCheckingMember, readsMembers, userId, reloadKey]);

  return { ...(showsDemo ? demoDirectory : state), retry: () => setReloadKey((key) => key + 1) };
}
