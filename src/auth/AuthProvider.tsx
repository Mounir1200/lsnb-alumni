import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  lastEvent: AuthChangeEvent | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [lastEvent, setLastEvent] = useState<AuthChangeEvent | null>(null);

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
    () => ({ session, user: session?.user ?? null, isLoading, lastEvent }),
    [isLoading, lastEvent, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
