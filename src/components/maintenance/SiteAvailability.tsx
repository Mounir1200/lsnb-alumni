import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { supabase } from "../../lib/supabase";
import {
  activityRoute,
  parseSiteStatus,
  type SiteStatus,
} from "../../lib/siteAvailability";
import { MaintenancePage } from "./MaintenancePage";

export function SiteAvailability({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<{
    status: SiteStatus;
    offset: number;
    userId: string | null;
    active: boolean;
  } | null>(null);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const requestNumber = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const preview = import.meta.env.DEV
    ? new URLSearchParams(location.search).get("maintenance-preview")
    : null;
  const previewStatus = useRef<SiteStatus>({
    enabled: true,
    active: true,
    message:
      "Nous améliorons votre espace pour que les prochaines rencontres soient encore plus simples. À très bientôt.",
    ends_at: new Date(Date.now() + 5430000).toISOString(),
    started_at: new Date().toISOString(),
    server_time: new Date().toISOString(),
  });

  const check = useCallback(async () => {
    if (!supabase || isLoading || preview) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const request = ++requestNumber.current;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const started = Date.now();
    setChecking(true);
    try {
      const result = await supabase
        .rpc("public_site_status")
        .abortSignal(controller.signal);
      if (result.error) throw result.error;
      const status = parseSiteStatus(result.data);
      const statusReceived = Date.now();
      let active = true;
      if (user) {
        const access = await supabase
          .rpc("member_access_status")
          .abortSignal(controller.signal);
        if (access.error || typeof access.data?.active !== "boolean")
          throw new Error("Unavailable member status");
        active = access.data.active;
      }
      if (request !== requestNumber.current) return;
      setState({
        status,
        active,
        userId: user?.id ?? null,
        offset: Date.parse(status.server_time) - (started + statusReceived) / 2,
      });
      setError(false);
    } catch {
      if (request === requestNumber.current) setError(true);
    } finally {
      window.clearTimeout(timeout);
      if (request === requestNumber.current) setChecking(false);
    }
  }, [user?.id, isLoading, preview]);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 15000);
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      ++requestNumber.current;
      abort.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [check]);

  const allowed = Boolean(
    state &&
    !error &&
    !state.status.active &&
    state.active &&
    state.userId === (user?.id ?? null),
  );
  useEffect(() => {
    const route = activityRoute(location.pathname);
    if (allowed && user && route && !preview)
      void supabase
        ?.rpc("record_member_activity", { p_route: route })
        .then(() => undefined);
  }, [allowed, user?.id, location.pathname, preview]);

  if (preview)
    return (
      <MaintenancePage
        status={{
          ...previewStatus.current,
          ends_at:
            preview === "indefinite" ? null : previewStatus.current.ends_at,
        }}
        clockOffset={0}
        onRetry={() => undefined}
        checking={false}
        preview
      />
    );
  if (!supabase) return children;
  if (state?.status.active)
    return (
      <MaintenancePage
        status={state.status}
        clockOffset={state.offset}
        onRetry={() => void check()}
        checking={checking}
        error={error}
      />
    );
  if (!error && state && state.userId === user?.id && !state.active)
    return (
      <div className="availability-screen">
        <div>
          <span className="maintenance-kicker">LSNB Réseau</span>
          <h1>Votre accès a été retiré.</h1>
          <p>
            L’équipe de modération a suspendu votre accès au réseau. Vous pouvez
            lui demander de vérifier votre appartenance à la promotion.
          </p>
          <button onClick={() => void supabase?.auth.signOut()}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  if (!allowed || isLoading)
    return (
      <div className="availability-screen">
        <div role="status">
          <span className="maintenance-kicker">LSNB Réseau</span>
          <h1>
            {error
              ? "Le réseau est momentanément indisponible."
              : "Nous ouvrons les portes…"}
          </h1>
          <p>
            {error
              ? "Nous ne pouvons pas vérifier la disponibilité du service. Réessayez dans quelques instants."
              : "Vérification de la disponibilité du réseau."}
          </p>
          {error && (
            <button disabled={checking} onClick={() => void check()}>
              Réessayer
            </button>
          )}
        </div>
      </div>
    );
  return children;
}
