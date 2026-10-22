import {
  Activity,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Terminal,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  type Context,
  type SiteStatus,
  demoRole,
  roleName,
  rpc,
  useResource,
} from "./api";
import {
  AuditLog,
  Maintenance,
  Members,
  Overview,
  ServerLogs,
  Team,
} from "./screens";
import { ErrorState, Loading, Status } from "./ui";
import "./styles.css";

type Screen =
  "overview" | "members" | "team" | "maintenance" | "audit" | "logs";
const nav = [
  {
    id: "overview",
    label: "Vue d’ensemble",
    icon: LayoutDashboard,
    admin: false,
  },
  { id: "members", label: "Membres & promotions", icon: Users, admin: false },
  { id: "team", label: "Équipe & accès", icon: Shield, admin: true },
  { id: "maintenance", label: "Maintenance", icon: Wrench, admin: true },
  { id: "audit", label: "Journal de modération", icon: Activity, admin: false },
  { id: "logs", label: "Logs du serveur", icon: Terminal, admin: true },
] as const;
function siteUrl() {
  try {
    const url = new URL(String(import.meta.env.VITE_SITE_URL || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
const publicUrl = siteUrl();

function Login({
  session,
  error,
  onLogout,
  reload,
}: {
  session: Session | null;
  error: string;
  onLogout: () => void;
  reload: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error)
        setAuthError(
          "Connexion impossible. Vérifiez votre adresse et votre mot de passe.",
        );
    } catch {
      setAuthError("Le service est inaccessible. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    if (!supabase) return;
    setBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    });
    if (error) {
      setAuthError("La connexion Google n’a pas pu démarrer. Réessayez.");
      setBusy(false);
    }
  }
  return (
    <main className="hub-login">
      <div className="hub-login-intro">
        <img src="/images/brand/alumni-lsnb-logo-green.png" alt="LSNB Réseau" />
        <span className="hub-eyebrow">L’espace de l’équipe</span>
        <h1>
          Prendre soin
          <br />
          du réseau.
        </h1>
        <p>
          Accompagner les promotions.
          <br />
          Préserver la confiance.
          <br />
          Faire grandir les liens.
        </p>
        <span className="hub-login-location">
          Lycée Scientifique National
          <br />
          Bobo-Dioulasso, Burkina Faso
        </span>
      </div>
      <section className="hub-login-form">
        <Shield size={28} strokeWidth={1.4} />
        <h2>{session ? "Vérifier votre accès" : "Bienvenue dans le hub."}</h2>
        <p>
          {session
            ? `Vous êtes connecté avec ${session.user.email || "votre compte"}.`
            : "Connectez-vous avec le compte auquel un rôle d’administration ou de modération a été attribué."}
        </p>
        {!isSupabaseConfigured && (
          <ErrorState message="Le service d’authentification n’est pas configuré pour ce déploiement. Contactez l’administrateur technique." />
        )}
        {(error || authError) && (
          <ErrorState
            message={authError || error}
            retry={session ? reload : undefined}
          />
        )}
        {session ? (
          <button className="hub-button" onClick={onLogout}>
            <LogOut size={16} />
            Utiliser un autre compte
          </button>
        ) : (
          <>
            <form onSubmit={signIn}>
              <label className="hub-field">
                Adresse e-mail
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom@exemple.fr"
                  disabled={busy}
                />
              </label>
              <label className="hub-field">
                Mot de passe
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                className="hub-button primary"
                disabled={busy || !isSupabaseConfigured}
              >
                {busy ? (
                  <LoaderCircle size={17} className="hub-spin" />
                ) : (
                  <ArrowUpRight size={17} />
                )}
                {busy ? "Connexion…" : "Accéder au hub"}
              </button>
            </form>
            <div className="hub-login-divider">
              <span>ou</span>
            </div>
            <button
              className="hub-button hub-google"
              disabled={busy || !isSupabaseConfigured}
              onClick={() => void google()}
            >
              <img src="/images/google-g.png" alt="" />
              Continuer avec Google
            </button>
          </>
        )}
        <small>Accès réservé à l’équipe LSNB Réseau.</small>
        {publicUrl && (
          <a className="hub-text-button" href={publicUrl}>
            Retour au réseau <ArrowUpRight size={14} />
          </a>
        )}
      </section>
    </main>
  );
}

function Hub({
  context,
  session,
  onLogout,
}: {
  context: Context;
  session: Session | null;
  onLogout: () => void;
}) {
  const allowed = nav.filter((item) => context.role === "admin" || !item.admin);
  const resolveScreen = (): Screen =>
    allowed.find((item) => `#${item.id}` === window.location.hash)?.id ||
    "overview";
  const [screen, setScreen] = useState<Screen>(resolveScreen);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [promotion, setPromotion] = useState<number | undefined>();
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const status = useResource(
    () => rpc<SiteStatus>("public_site_status"),
    `shell-status-${revision}`,
  );
  useEffect(() => {
    const timer = setInterval(status.refresh, 30000);
    return () => clearInterval(timer);
  }, [status.refresh]);
  useEffect(() => {
    const handle = () => {
      if (window.location.hash === "#hub-main") return;
      setScreen(resolveScreen());
      setMobileOpen(false);
    };
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [context.role]);
  useEffect(() => {
    if (mobileOpen) drawer.current?.showModal();
    else if (drawer.current?.open) {
      drawer.current.close();
      menuButton.current?.focus();
    }
  }, [mobileOpen]);
  useEffect(() => {
    document.title = `${allowed.find((n) => n.id === screen)?.label || "Administration"} · LSNB`;
  }, [screen]);
  function go(next: Screen, year?: number) {
    setPromotion(year);
    setScreen(next);
    window.location.hash = next;
    setMobileOpen(false);
  }
  const navigation = (
    <>
      <div className="hub-brand">
        <img src="/images/brand/alumni-lsnb-emblem.png" alt="" />
        <div>
          <strong>
            LSNB Réseau<span>Le hub</span>
          </strong>
        </div>
      </div>
      <div className="hub-scope">
        <Shield size={16} />
        <div>
          <strong>
            {context.role === "admin" ? "Administration" : "Modération"}
          </strong>
          <span>
            {context.role === "admin"
              ? "Toutes les promotions"
              : `Promotion ${context.graduation_year}`}
          </span>
        </div>
      </div>
      <nav aria-label="Navigation du hub">
        <span className="hub-nav-caption">Le réseau</span>
        {allowed.map((item, i) => (
          <div key={item.id}>
            {i === 3 && context.role === "admin" && (
              <span className="hub-nav-caption">Pilotage</span>
            )}
            <button
              aria-label={item.label}
              title={item.label}
              aria-current={screen === item.id ? "page" : undefined}
              className={`hub-nav-item ${screen === item.id ? "is-active" : ""}`}
              onClick={() => go(item.id)}
            >
              <item.icon size={18} strokeWidth={1.7} />
              <span>{item.label}</span>
              {screen === item.id && (
                <ChevronRight className="hub-nav-arrow" size={14} />
              )}
            </button>
          </div>
        ))}
      </nav>
      <div className="hub-sidebar-bottom">
        {publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="hub-nav-item"
          >
            <ExternalLink size={17} />
            <span>Ouvrir le site</span>
          </a>
        )}
        <div className="hub-user">
          <span className="hub-avatar">
            {context.display_name?.charAt(0) || "L"}
          </span>
          <div>
            <strong>{context.display_name || "Équipe LSNB"}</strong>
            <span>{roleName(context.role)}</span>
          </div>
          <button
            className="hub-icon-button"
            title="Se déconnecter"
            aria-label="Se déconnecter"
            onClick={onLogout}
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </>
  );
  return (
    <div className={`hub-app ${collapsed ? "is-collapsed" : ""}`}>
      <a href="#hub-main" className="hub-skip">
        Aller au contenu
      </a>
      <aside className="hub-sidebar">
        {navigation}
        <button
          className="hub-collapse hub-icon-button"
          title={collapsed ? "Développer le menu" : "Réduire le menu"}
          aria-label={collapsed ? "Développer le menu" : "Réduire le menu"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
      </aside>
      <dialog
        className="hub-mobile-drawer"
        ref={drawer}
        aria-label="Navigation du hub"
        onCancel={(e) => {
          e.preventDefault();
          setMobileOpen(false);
        }}
      >
        <button
          className="hub-drawer-close hub-icon-button"
          aria-label="Fermer le menu"
          onClick={() => setMobileOpen(false)}
        >
          <X size={19} />
        </button>
        {navigation}
      </dialog>
      <div className="hub-workspace">
        <header className="hub-topbar">
          <div>
            <button
              ref={menuButton}
              className="hub-mobile-toggle hub-icon-button"
              aria-label="Ouvrir le menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Hub</span>
            <ChevronRight size={13} />
            <strong>{allowed.find((n) => n.id === screen)?.label}</strong>
          </div>
          <div>
            {status.data ? (
              <Status active={!status.data.active}>
                {status.data.active ? "Site en maintenance" : "Site ouvert"}
              </Status>
            ) : (
              <span className="hub-muted">
                {status.error
                  ? "État du site indisponible"
                  : "Vérification du site…"}
              </span>
            )}
            <span className="hub-top-date">
              {new Intl.DateTimeFormat("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </span>
          </div>
        </header>
        {demoRole && (
          <div className="hub-demo-banner">
            Aperçu local · données fictives · aucun changement réel possible ·
            rôle {roleName(demoRole).toLowerCase()}
          </div>
        )}
        <main id="hub-main" className="hub-content" tabIndex={-1}>
          {screen === "overview" && (
            <Overview
              context={context}
              revision={revision}
              goMembers={(year) => go("members", year)}
            />
          )}
          {screen === "members" && (
            <Members
              key={promotion ?? "all"}
              context={context}
              revision={revision}
              initialPromotion={promotion}
            />
          )}
          {screen === "team" && context.role === "admin" && (
            <Team context={context} revision={revision} />
          )}
          {screen === "maintenance" && context.role === "admin" && (
            <Maintenance
              revision={revision}
              onChanged={() => setRevision((v) => v + 1)}
            />
          )}
          {screen === "audit" && (
            <AuditLog context={context} revision={revision} />
          )}
          {screen === "logs" && context.role === "admin" && (
            <ServerLogs
              token={session?.access_token || ""}
              revision={revision}
            />
          )}
          <footer className="hub-footer">
            <span>LSNB Réseau · L’espace de l’équipe</span>
            <span>
              {context.role === "admin"
                ? "Administration"
                : `Modération · promotion ${context.graduation_year}`}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(
    !demoRole && isSupabaseConfigured,
  );
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (demoRole || !supabase) return;
    let alive = true;
    let authEventReceived = false;
    const deadline = setTimeout(() => {
      if (alive) {
        setAuthLoading(false);
        setError(
          "Le service met trop de temps à répondre. Vous pouvez réessayer de vous connecter.",
        );
      }
    }, 15000);
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (alive && !authEventReceived) {
          clearTimeout(deadline);
          setSession(data.session);
          setAuthLoading(false);
          if (error)
            setError(
              "Votre session n’a pas pu être chargée. Reconnectez-vous.",
            );
        }
      })
      .catch(() => {
        if (alive) {
          setAuthLoading(false);
          setError("Le service est inaccessible. Réessayez dans un instant.");
        }
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) {
        authEventReceived = true;
        clearTimeout(deadline);
        setSession(next);
        setAuthLoading(false);
        if (!next) {
          setContext(null);
          setError("");
        }
      }
    });
    return () => {
      alive = false;
      clearTimeout(deadline);
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!session && !demoRole) {
      setContext(null);
      return;
    }
    let alive = true;
    setChecking(true);
    async function check() {
      try {
        const next = await rpc<Context>("hub_context");
        if (alive) {
          if (!next || !["admin", "moderator"].includes(next.role))
            throw new Error(
              "Ce compte ne dispose pas d’un accès au hub. Un administrateur doit vous attribuer un rôle.",
            );
          setContext(next);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setContext(null);
          setError(
            e instanceof Error
              ? e.message
              : "Impossible de vérifier vos droits.",
          );
        }
      } finally {
        if (alive) setChecking(false);
      }
    }
    void check();
    const timer = setInterval(() => void check(), 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session?.access_token, retry]);
  async function logout() {
    if (demoRole) {
      window.location.assign(window.location.pathname);
      return;
    }
    setContext(null);
    setSession(null);
    setError("");
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error)
        setError("La déconnexion n’a pas pu être confirmée. Réessayez.");
    }
  }
  if (authLoading || (checking && !context))
    return (
      <div className="hub-gate">
        <Loading label="Vérification de votre accès au hub…" />
      </div>
    );
  if (context && (demoRole || context.user_id === session?.user.id))
    return (
      <Hub
        key={`${context.user_id}-${context.role}-${context.graduation_year}`}
        context={context}
        session={session}
        onLogout={() => void logout()}
      />
    );
  return (
    <Login
      session={session}
      error={error}
      onLogout={() => void logout()}
      reload={() => setRetry((v) => v + 1)}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
