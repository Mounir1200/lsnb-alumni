import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAudience } from "../../hooks/useAudience";
import { profileInvitation } from "../../lib/invitations";
import { CHARTER_PATH, SITE_NAME } from "../../lib/site";
import { BrandMark } from "../ui/BrandMark";

export function SiteFooter() {
  const { action: profileLink } = profileInvitation(useAudience());
  return (
    <footer className="site-footer">
      <div className="page-shell site-footer__grid">
        <div>
          <BrandMark variant="stacked" />
          <p className="site-footer__statement">
            Les trajectoires changent.<br />Le point de départ nous relie.
          </p>
        </div>

        <nav className="site-footer__nav" aria-label="Explorer">
          <p>Explorer</p>
          <Link to="/annuaire">Annuaire</Link>
          <Link to="/highlights">Highlight de la semaine</Link>
          <Link to="/annuaire?mentor=true">Trouver un mentor</Link>
          <Link to="/offres">Stages, bourses et admissions</Link>
          <Link to={profileLink.to}>{profileLink.label}</Link>
        </nav>

        <nav className="site-footer__nav" aria-label="À propos">
          <p>À propos</p>
          <Link to="/#reseau">Le réseau</Link>
          <a href="mailto:contact@lsnb-reseau.org">Nous écrire</a>
          <Link to={CHARTER_PATH}>Charte de conduite</Link>
          <Link to="/confidentialite">Confidentialité</Link>
        </nav>
      </div>

      <div className="page-shell site-footer__bottom">
        <span>© {new Date().getFullYear()} {SITE_NAME}</span>
        <a
          href="https://www.lobspaalga.com/2023/07/02/lycee-scientifique-de-bobo-pas-de-frais-de-scolarite-pour-les-eleves/"
          target="_blank"
          rel="noreferrer"
        >
          Photo du lycée : L’Obs Paalga
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </footer>
  );
}
