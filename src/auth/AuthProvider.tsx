import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { loadOnboardingProfile } from "../lib/onboardingRepository";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  lastEvent: AuthChangeEvent | null;
  profileCompleted: boolean | null;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [lastEvent, setLastEvent] = useState<AuthChangeEvent | null>(null);
  const [profileState, setProfileState] = useState<{ userId: string; completed: boolean | null; error: string | null } | null>(null);
  const userId = session?.user.id;
  const currentUserId = useRef(userId);
  currentUserId.current = userId;
  const profileRequest = useRef(0);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const request = ++profileRequest.current;
    try {
      const profile = await loadOnboardingProfile(userId);
      if (currentUserId.current === userId && profileRequest.current === request) setProfileState({ userId, completed: profile.profile_completed, error: null });
    } catch {
      if (currentUserId.current === userId && profileRequest.current === request) setProfileState({ userId, completed: null, error: "Impossible de vérifier votre profil. Réessayez." });
    }
  }, [userId]);

  useEffect(() => { void refreshProfile(); }, [refreshProfile]);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    let hasReceivedAuthEvent = false;
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;
      hasReceivedAuthEvent = true;
      setSession(nextSession);
      setLastEvent(event);
      setIsLoading(false);
    });

    void supabase.auth
      .getSession()
      .then(({ data: sessionData }) => {
        if (!isMounted || hasReceivedAuthEvent) return;
        setSession(sessionData.session);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isMounted || hasReceivedAuthEvent) return;
        setSession(null);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, isLoading, lastEvent,
      profileCompleted: profileState?.userId === userId ? profileState?.completed ?? null : null,
      profileError: profileState?.userId === userId ? profileState?.error ?? null : null,
      refreshProfile,
    }),
    [isLoading, lastEvent, session, profileState, userId, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
