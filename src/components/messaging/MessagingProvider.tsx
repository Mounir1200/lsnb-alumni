import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircle, X } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "../../auth/AuthProvider";
import {
  countUnreadMessages, DeviceAccessError, messagingDevice, needsReconnect, recordMessagingPresence, type DeviceAccessProblem,
} from "../../lib/messagingRepository";
import { supabase } from "../../lib/supabase";
import "./Messaging.css";

export type MessagingAccess = "checking" | "ready" | DeviceAccessProblem;
type MessagingContextValue = {
  unread: number; revision: number; connected: boolean; refresh: () => void;
  access: MessagingAccess; retryAccess: () => void; reportError: (error: unknown) => void;
};
type MessageSignal = { conversation_id?: unknown; recipient_id?: unknown; change?: unknown };
export const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

const REFRESH_INTERVAL_MS = 30000;
const PRESENCE_INTERVAL_MS = 25000;
const IDLE_AFTER_MS = 120000;

/** Gives this browser its messaging key right after sign-in, while the sign-in is still recent. */
function useMessagingAccess(userId: string | undefined) {
  const [state, setState] = useState<{ userId: string; access: MessagingAccess }>();
  const [attempt, setAttempt] = useState(0);
  const previousUser = useRef(userId);

  useEffect(() => {
    // Signing out or switching accounts leaves no usable key behind in this browser.
    if (previousUser.current && previousUser.current !== userId) void messagingDevice.forget();
    previousUser.current = userId;
    if (!userId) return;
    let active = true;
    setState({ userId, access: "checking" });
    void messagingDevice.ensureDevice()
      .then(() => { if (active) setState({ userId, access: "ready" }); })
      .catch((error: unknown) => {
        if (active) setState({ userId, access: error instanceof DeviceAccessError ? error.problem : "unavailable" });
      });
    return () => { active = false; };
  }, [userId, attempt]);

  const retryAccess = useCallback(() => setAttempt((value) => value + 1), []);
  const reportError = useCallback((error: unknown) => {
    if (!userId || !needsReconnect(error)) return;
    void messagingDevice.forget();
    setState({ userId, access: "reconnect" });
  }, [userId]);
  const access: MessagingAccess = userId && state?.userId === userId ? state.access : "checking";
  return { access, retryAccess, reportError };
}

export function MessagingProvider({ children }: { children: ReactNode }) {
  const { user, profileCompleted } = useAuth();
  const location = useLocation();
  const path = useRef(location.pathname);
  path.current = location.pathname;
  const userId = user?.id;
  const { access, retryAccess, reportError } = useMessagingAccess(userId);
  const [state, setState] = useState<{
    userId: string; unread: number; revision: number; connected: boolean; toast?: string;
  }>();
  const refreshRef = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    setState((previous) => previous?.toast && location.pathname === `/espace/messages/${previous.toast}`
      ? { ...previous, toast: undefined } : previous);
  }, [location.pathname]);

  useEffect(() => {
    if (!userId || !profileCompleted || !supabase || access !== "ready") {
      refreshRef.current = () => undefined;
      return;
    }
    const client = supabase;
    let active = true;
    let countRequest = 0;
    let lastActivity = Date.now();
    let lastHeartbeat = 0;
    let heartbeatBusy = false;
    let channel: RealtimeChannel | undefined;
    setState({ userId, unread: 0, revision: 0, connected: false });

    const refreshData = () => {
      if (!active) return;
      setState((previous) => previous?.userId === userId ? { ...previous, revision: previous.revision + 1 } : previous);
      const request = ++countRequest;
      void countUnreadMessages().then((unread) => {
        if (active && request === countRequest) setState((previous) => previous?.userId === userId ? { ...previous, unread } : previous);
      }).catch(reportError);
    };

    const heartbeat = () => {
      const now = Date.now();
      if (!active || heartbeatBusy || document.visibilityState !== "visible" || !document.hasFocus()
        || now - lastActivity > IDLE_AFTER_MS || now - lastHeartbeat < PRESENCE_INTERVAL_MS) return;
      heartbeatBusy = true;
      lastHeartbeat = now;
      void recordMessagingPresence().catch((error: unknown) => { lastHeartbeat = 0; reportError(error); })
        .finally(() => { heartbeatBusy = false; });
    };
    const activity = () => { lastActivity = Date.now(); heartbeat(); };
    const foreground = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        lastActivity = Date.now();
        refreshData();
        heartbeat();
      }
    };
    // Signals name the conversation only; the text is then fetched through the signed calls.
    const signalled = (signal: MessageSignal) => {
      if (!active) return;
      refreshData();
      if (signal.change === "insert" && signal.recipient_id === userId && typeof signal.conversation_id === "string"
        && path.current !== `/espace/messages/${signal.conversation_id}`) {
        setState((previous) => previous?.userId === userId ? { ...previous, toast: String(signal.conversation_id) } : previous);
      }
    };
    void client.realtime.setAuth().catch(() => undefined).then(() => {
      if (!active) return;
      channel = client.channel(`messaging:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "message" }, ({ payload }) => signalled(payload as MessageSignal))
        .subscribe((status) => {
          if (!active) return;
          setState((previous) => previous?.userId === userId ? { ...previous, connected: status === "SUBSCRIBED" } : previous);
          if (status === "SUBSCRIBED") refreshData();
        });
    });

    refreshRef.current = refreshData;
    refreshData();
    heartbeat();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshData();
      heartbeat();
    }, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", foreground);
    window.addEventListener("online", foreground);
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    window.addEventListener("scroll", activity, { passive: true });
    return () => {
      active = false;
      ++countRequest;
      refreshRef.current = () => undefined;
      window.clearInterval(interval);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("scroll", activity);
      if (channel) void client.removeChannel(channel);
    };
  }, [userId, profileCompleted, access, reportError]);

  const current = userId && state?.userId === userId && access === "ready" ? state : undefined;
  const value = useMemo(() => ({ unread: current?.unread ?? 0, revision: current?.revision ?? 0,
    connected: current?.connected ?? false, refresh, access, retryAccess, reportError }),
  [current?.unread, current?.revision, current?.connected, refresh, access, retryAccess, reportError]);
  const dismiss = () => setState((previous) => previous && ({ ...previous, toast: undefined }));

  return <MessagingContext.Provider value={value}>
    {children}
    {current?.toast && location.pathname !== `/espace/messages/${current.toast}` && (
      <div className="message-notification" role="status" aria-live="polite">
        <MessageCircle size={21} aria-hidden="true" />
        <Link to={`/espace/messages/${current.toast}`} onClick={dismiss}>Vous avez reçu un nouveau message. Ouvrir la conversation</Link>
        <button onClick={dismiss} aria-label="Fermer la notification"><X size={18} aria-hidden="true" /></button>
      </div>
    )}
  </MessagingContext.Provider>;
}

export function useMessaging() {
  const context = useContext(MessagingContext);
  if (!context) throw new Error("useMessaging must be used inside MessagingProvider");
  return context;
}

export function UnreadMessagesBadge() {
  const { unread } = useMessaging();
  if (!unread) return null;
  return <span className="message-unread-count message-unread"><span aria-hidden="true">{unread > 99 ? "99+" : unread}</span><span className="sr-only">{unread} {unread > 1 ? "messages non lus" : "message non lu"}</span></span>;
}
