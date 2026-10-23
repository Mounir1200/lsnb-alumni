import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircle, X } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { countUnreadMessages, recordMessagingPresence } from "../../lib/messagingRepository";
import { supabase } from "../../lib/supabase";
import "./Messaging.css";

type MessagingContextValue = { unread: number; revision: number; connected: boolean; refresh: () => void };
export const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

export function MessagingProvider({ children }: { children: ReactNode }) {
  const { user, profileCompleted } = useAuth();
  const location = useLocation();
  const path = useRef(location.pathname);
  path.current = location.pathname;
  const userId = user?.id;
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
    if (!userId || !profileCompleted || !supabase) {
      refreshRef.current = () => undefined;
      return;
    }
    const client = supabase;
    let active = true;
    let countRequest = 0;
    let lastActivity = Date.now();
    let lastHeartbeat = 0;
    let heartbeatBusy = false;
    setState({ userId, unread: 0, revision: 0, connected: false });

    const refreshData = () => {
      if (!active) return;
      setState((previous) => previous?.userId === userId ? { ...previous, revision: previous.revision + 1 } : previous);
      const request = ++countRequest;
      void countUnreadMessages(userId).then((unread) => {
        if (active && request === countRequest) setState((previous) => previous?.userId === userId ? { ...previous, unread } : previous);
      }).catch(() => undefined);
    };

    const heartbeat = () => {
      const now = Date.now();
      if (!active || heartbeatBusy || document.visibilityState !== "visible" || !document.hasFocus()
        || now - lastActivity > 120000 || now - lastHeartbeat < 25000) return;
      heartbeatBusy = true;
      lastHeartbeat = now;
      void recordMessagingPresence().catch(() => { lastHeartbeat = 0; }).finally(() => { heartbeatBusy = false; });
    };
    const activity = () => { lastActivity = Date.now(); heartbeat(); };
    const foreground = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        lastActivity = Date.now();
        refreshData();
        heartbeat();
      }
    };
    const changed = (payload: { eventType: string; new: Record<string, unknown> }) => {
      if (!active) return;
      refreshData();
      const message = payload.new;
      if (payload.eventType === "INSERT" && message.recipient_id === userId && typeof message.conversation_id === "string"
        && path.current !== `/espace/messages/${message.conversation_id}`) {
        setState((previous) => previous?.userId === userId ? { ...previous, toast: String(message.conversation_id) } : previous);
      }
    };
    const channel = client.channel(`messages:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_messages", filter: `recipient_id=eq.${userId}` }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_messages", filter: `sender_id=eq.${userId}` }, changed)
      .subscribe((status) => {
        if (!active) return;
        setState((previous) => previous?.userId === userId ? { ...previous, connected: status === "SUBSCRIBED" } : previous);
        if (status === "SUBSCRIBED") refreshData();
      });

    refreshRef.current = refreshData;
    refreshData();
    heartbeat();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshData();
      heartbeat();
    }, 30000);
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
      void client.removeChannel(channel);
    };
  }, [userId, profileCompleted]);

  const current = userId && state?.userId === userId ? state : undefined;
  const value = useMemo(() => ({ unread: current?.unread ?? 0, revision: current?.revision ?? 0,
    connected: current?.connected ?? false, refresh }), [current?.unread, current?.revision, current?.connected, refresh]);
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
