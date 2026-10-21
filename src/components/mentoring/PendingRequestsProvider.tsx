import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { countPendingReceivedRequests } from "../../lib/mentorshipRepository";

type PendingRequestsContextValue = {
  count: number;
  refresh: () => void;
};

const PendingRequestsContext = createContext<PendingRequestsContextValue | undefined>(undefined);

// No email announces a new request, so the count is refreshed on every navigation.
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
  const count = userId && state?.userId === userId ? state.count : 0;
  const value = useMemo(() => ({ count, refresh }), [count, refresh]);

  return <PendingRequestsContext.Provider value={value}>{children}</PendingRequestsContext.Provider>;
}

export function usePendingRequests() {
  const context = useContext(PendingRequestsContext);
  if (!context) throw new Error("usePendingRequests must be used inside PendingRequestsProvider");
  return context;
}
