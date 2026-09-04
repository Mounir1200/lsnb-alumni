import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { BrandMark } from "../ui/BrandMark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-shell site-footer__grid">
        <div>
          <BrandMark variant="stacked" />
          <p className="site-footer__statement">
            Les trajectoires changent.<br />Le point de départ nous relie.
          </p>
        </div>

        <div className="site-footer__nav">
          <p>Explorer</p>
          <Link to="/annuaire">Annuaire</Link>
          <Link to="/annuaire?mentor=true">Trouver un mentor</Link>
          <Link to="/rejoindre">Créer un profil</Link>
        </div>

        <div className="site-footer__nav">
          <p>À propos</p>
          <Link to="/#reseau">Le réseau</Link>
          <a href="mailto:contact@lsnb-reseau.org">Nous écrire</a>
          <Link to="/confidentialite">Confidentialité</Link>
        </div>

        <a
          className="site-footer__school-link"
          href="https://www.lobspaalga.com/2023/07/02/lycee-scientifique-de-bobo-pas-de-frais-de-scolarite-pour-les-eleves/"
          target="_blank"
          rel="noreferrer"
        >
          Voir la source de la photo du lycée
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      </div>

      <div className="page-shell site-footer__bottom">
        <span>© {new Date().getFullYear()} LSNB Réseau — prototype indépendant</span>
        <span>Bobo-Dioulasso · Burkina Faso</span>
      </div>
    </footer>
  );
}
