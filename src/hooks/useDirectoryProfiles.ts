import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { alumniProfiles, type AlumniProfile } from "../data/alumni";
import { loadProfiles } from "../lib/profileRepository";
import { isSupabaseConfigured } from "../lib/supabase";

type DirectoryProfilesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; profiles: AlumniProfile[]; source: "demo" | "supabase" };

const demoDirectory: DirectoryProfilesState = { status: "ready", profiles: alumniProfiles, source: "demo" };

// Member profiles are readable only once signed in: visitors keep the fictional showcase.
export function useDirectoryProfiles() {
  const { user, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<DirectoryProfilesState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const userId = user?.id;
  const showsDemo = !isSupabaseConfigured || (!authLoading && !userId);

  useEffect(() => {
    if (showsDemo || authLoading) return;
    let active = true;
    setState({ status: "loading" });
    loadProfiles()
      .then((result) => { if (active) setState({ status: "ready", ...result }); })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [showsDemo, authLoading, userId, reloadKey]);

  return { ...(showsDemo ? demoDirectory : state), retry: () => setReloadKey((key) => key + 1) };
}
