import { MessageCircle, Network, UserRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import { UnreadMessagesBadge } from "./MessagingProvider";

export function MessagingNavigation() {
  return <nav className="messages-navigation" aria-label="Navigation de la messagerie">
    <NavLink to="/espace" end><UserRound size={17} aria-hidden="true" /> Mon espace</NavLink>
    <NavLink to="/espace/relations"><Network size={17} aria-hidden="true" /> Mes relations</NavLink>
    <NavLink to="/espace/messages"><MessageCircle size={17} aria-hidden="true" /> Mes messages <UnreadMessagesBadge /></NavLink>
  </nav>;
}
