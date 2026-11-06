import { DoorOpen, Handshake, LogOut, Menu, MessageCircle, Newspaper, Orbit, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, type Location } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useSignOut } from "../../auth/useSignOut";
import { cn } from "../../lib/cn";
import { usePendingRequests } from "../mentoring/PendingRequestsProvider";
import { UnreadMessagesBadge, useMessaging } from "../messaging/MessagingProvider";
import { BrandMark } from "../ui/BrandMark";
import { ButtonLink } from "../ui/Button";

const MAX_DISPLAYED_PENDING_COUNT = 9;

type NavigationItem = {
  label: string;
  to: string;
  isCurrent: (location: Location) => boolean;
  /** Shown on the phone menu's tiles only; the compact tiles of a member's own pages carry no hint. */
  icon: LucideIcon;
  hint?: string;
};

const isMentorDirectory = ({ pathname, search }: Location) =>
  pathname === "/annuaire" && new URLSearchParams(search).get("mentor") === "true";

const navigation: NavigationItem[] = [
  {
    label: "Annuaire",
    to: "/annuaire",
    // Member profiles belong to the directory; its mentor filter has its own entry.
    isCurrent: (location) =>
      (location.pathname === "/annuaire" && !isMentorDirectory(location))
      || location.pathname.startsWith("/alumni/"),
    icon: Users,
    hint: "Tous les parcours",
  },
  { label: "Mentorat", to: "/annuaire?mentor=true", isCurrent: isMentorDirectory, icon: Orbit, hint: "Trouver un mentor" },
  {
    label: "Offres",
    to: "/offres",
    isCurrent: ({ pathname }) => pathname === "/offres" || pathname.startsWith("/offres/"),
    icon: DoorOpen,
    hint: "Stages, bourses, admissions",
  },
  { label: "Highlights", to: "/highlights", isCurrent: ({ pathname }) => pathname === "/highlights", icon: Newspaper, hint: "Les portraits de la semaine" },
];

const relationsItem: NavigationItem = {
  label: "Mes relations",
  to: "/espace/relations",
  isCurrent: ({ pathname }) => pathname === "/espace/relations",
  icon: Handshake,
};

const messagesItem: NavigationItem = {
  label: "Messages",
  to: "/espace/messages",
  isCurrent: ({ pathname }) => pathname === "/espace/messages" || pathname.startsWith("/espace/messages/"),
  icon: MessageCircle,
};

const spaceItem: NavigationItem = {
  label: "Mon espace",
  to: "/espace",
  // Relations and messages live under it but have their own entries.
  isCurrent: (location) => location.pathname.startsWith("/espace")
    && !relationsItem.isCurrent(location) && !messagesItem.isCurrent(location),
  icon: UserRound,
};

const useIsCurrent = (item: NavigationItem) => item.isCurrent(useLocation());

function HeaderLink({ item, badge }: { item: NavigationItem; badge?: ReactNode }) {
  const isCurrent = useIsCurrent(item);
  return (
    <Link
      to={item.to}
      className={cn("site-header__link", isCurrent && "is-active")}
      aria-current={isCurrent ? "page" : undefined}
    >
      {item.label}
      {badge}
    </Link>
  );
}

/** A page on the phone menu: a square tile with its icon, its name and, for the site's pages, a short hint. */
function MenuTile({ item, badge }: { item: NavigationItem; badge?: ReactNode }) {
  const isCurrent = useIsCurrent(item);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn("site-header__tile", isCurrent && "is-active")}
      aria-current={isCurrent ? "page" : undefined}
    >
      <Icon size={22} aria-hidden="true" />
      <span className="site-header__tile-text">
        <b>{item.label}</b>
        {item.hint && <small aria-hidden="true">{item.hint}</small>}
      </span>
      {badge}
    </Link>
  );
}

function SignOutButton({ className }: { className: string }) {
  const { signOut, isSigningOut } = useSignOut();
  return (
    <button type="button" className={className} title="Se déconnecter" onClick={() => void signOut()} disabled={isSigningOut}>
      <LogOut size={16} aria-hidden="true" />
      <span className="site-header__signout-label">{isSigningOut ? "Déconnexion…" : "Se déconnecter"}</span>
    </button>
  );
}

function describePendingRequests(count: number) {
  return count > 1 ? `${count} demandes reçues en attente` : "1 demande reçue en attente";
}

function PendingCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="site-header__count">
      <span aria-hidden="true">
        {count > MAX_DISPLAYED_PENDING_COUNT ? `${MAX_DISPLAYED_PENDING_COUNT}+` : count}
      </span>
      <span className="sr-only">, {describePendingRequests(count)}</span>
    </span>
  );
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { user, isLoading } = useAuth();
  const { count: pendingRequests } = usePendingRequests();
  const { unread } = useMessaging();
  const relationsBadge = <PendingCount count={pendingRequests} />;

  // The key changes on every navigation, including a tap on the current page.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.key]);

  // The header stays on screen; once the reader leaves the top it compacts.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className={cn("site-header", !isLoading && user && "site-header--member")} data-scrolled={scrolled ? "true" : undefined}>
      <div className="site-header__inner page-shell">
        <BrandMark />

        <nav className="site-header__desktop-nav" aria-label="Navigation principale">
          {navigation.map((item) => <HeaderLink key={item.to} item={item} />)}
        </nav>

        <div className="site-header__actions">
          {!isLoading && user ? (
            <>
              <HeaderLink item={relationsItem} badge={relationsBadge} />
              <HeaderLink item={messagesItem} badge={<UnreadMessagesBadge />} />
              <ButtonLink to="/espace" size="sm" variant="light">
                Mon espace
              </ButtonLink>
              <SignOutButton className="site-header__signout" />
            </>
          ) : !isLoading ? (
            <>
              <NavLink to="/connexion" className="site-header__login">
                Se connecter
              </NavLink>
              <ButtonLink to="/rejoindre" size="sm" variant="light">
                Rejoindre le réseau
              </ButtonLink>
            </>
          ) : null}
        </div>

        <button
          type="button"
          className="site-header__menu-button"
          aria-label={menuOpen
            ? "Fermer le menu"
            : `Ouvrir le menu${pendingRequests > 0 ? `, ${describePendingRequests(pendingRequests)}` : ""}${unread > 0 ? `, ${unread} messages non lus` : ""}`}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          {!menuOpen && (pendingRequests > 0 || unread > 0) && <span className="site-header__menu-dot" aria-hidden="true" />}
        </button>
      </div>

      {menuOpen && (
        <div id="mobile-navigation" className="site-header__mobile-panel is-open">
          <nav aria-label="Navigation mobile" className="page-shell">
            <div className="site-header__mobile-tiles">
              {navigation.map((item) => <MenuTile key={item.to} item={item} />)}
            </div>
            {user ? (
              <>
                <div className="site-header__mobile-tiles site-header__mobile-tiles--own">
                  <MenuTile item={relationsItem} badge={relationsBadge} />
                  <MenuTile item={messagesItem} badge={<UnreadMessagesBadge />} />
                  <MenuTile item={spaceItem} />
                </div>
                <SignOutButton className="site-header__mobile-signout" />
              </>
            ) : (
              <>
                <NavLink to="/connexion" className="site-header__mobile-login">Se connecter</NavLink>
                <ButtonLink to="/rejoindre" variant="light" className="mt-2">
                  Rejoindre le réseau
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
