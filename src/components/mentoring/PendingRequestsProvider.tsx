import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { countPendingReceivedRequests } from "../../lib/mentorshipRepository";
import { supabase } from "../../lib/supabase";

type PendingRequestsContextValue = {
  count: number;
  revision: number;
  refresh: () => void;
};

const PendingRequestsContext = createContext<PendingRequestsContextValue | undefined>(undefined);

// First-contact requests stay on site; private conversation reminders start after acceptance.
export function PendingRequestsProvider({ children }: { children: ReactNode }) {
  const { user, profileCompleted } = useAuth();
  const { key: locationKey } = useLocation();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ userId: string; count: number }>();
  const userId = user?.id;

  useEffect(() => {
    if (!userId || !profileCompleted) return;
    let active = true;
    countPendingReceivedRequests(userId)
      .then((count) => { if (active) setState({ userId, count }); })
      // A failed count only leaves the badge as it was; the relations page reports errors.
      .catch(() => undefined);
    return () => { active = false; };
  }, [userId, profileCompleted, locationKey, reload]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    if (!userId || !profileCompleted || !supabase) return;
    const client = supabase;
    let active = true;
    const changed = () => { if (active) refresh(); };
    const foreground = () => { if (document.visibilityState === "visible") changed(); };
    const channel = client.channel(`connection-requests:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "connection_requests", filter: `recipient_id=eq.${userId}` }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "connection_requests", filter: `requester_id=eq.${userId}` }, changed)
      .subscribe((status) => { if (status === "SUBSCRIBED") changed(); });
    const timer = window.setInterval(foreground, 30000);
    window.addEventListener("focus", foreground);
    window.addEventListener("online", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
      document.removeEventListener("visibilitychange", foreground);
      void client.removeChannel(channel);
    };
  }, [userId, profileCompleted, refresh]);
  const count = userId && state?.userId === userId ? state.count : 0;
  const value = useMemo(() => ({ count, revision: reload, refresh }), [count, reload, refresh]);

  return <PendingRequestsContext.Provider value={value}>{children}</PendingRequestsContext.Provider>;
}

export function usePendingRequests() {
  const context = useContext(PendingRequestsContext);
  if (!context) throw new Error("usePendingRequests must be used inside PendingRequestsProvider");
  return context;
}
