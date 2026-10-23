import { Menu, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, type Location } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
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
  },
  { label: "Mentorat", to: "/annuaire?mentor=true", isCurrent: isMentorDirectory },
  { label: "Offres", to: "/offres", isCurrent: ({ pathname }) => pathname === "/offres" || pathname.startsWith("/offres/") },
  { label: "Highlights", to: "/highlights", isCurrent: ({ pathname }) => pathname === "/highlights" },
];

const relationsItem: NavigationItem = {
  label: "Mes relations",
  to: "/espace/relations",
  isCurrent: ({ pathname }) => pathname === "/espace/relations",
};

const messagesItem: NavigationItem = {
  label: "Messages",
  to: "/espace/messages",
  isCurrent: ({ pathname }) => pathname === "/espace/messages" || pathname.startsWith("/espace/messages/"),
};

function HeaderLink({ item, badge }: { item: NavigationItem; badge?: ReactNode }) {
  const isCurrent = item.isCurrent(useLocation());
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

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className="site-header">
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
            {navigation.map((item) => <HeaderLink key={item.to} item={item} />)}
            {user ? (
              <>
                <HeaderLink item={relationsItem} badge={relationsBadge} />
                <HeaderLink item={messagesItem} badge={<UnreadMessagesBadge />} />
                <ButtonLink to="/espace" variant="light" className="mt-2">
                  Mon espace
                </ButtonLink>
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
