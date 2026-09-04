import {
  ArrowRight,
  BookOpen,
  Compass,
  Map,
  MessageCircle,
  Microscope,
  Orbit,
} from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlumniCard } from "../components/alumni/AlumniCard";
import { Hero } from "../components/home/Hero";
import { Reveal } from "../components/motion/Reveal";
import { ButtonLink } from "../components/ui/Button";
import { alumniProfiles } from "../data/alumni";

const discoveryPaths = [
  {
    icon: Microscope,
    label: "Par spécialité",
    value: "Biostatistiques",
    detail: "Voir qui a étudié ou travaille dans ce champ.",
    to: "/annuaire?q=Biostatistiques",
  },
  {
    icon: Map,
    label: "Par pays",
    value: "Burkina Faso",
    detail: "Trouver un ancien près de chez soi ou de sa future destination.",
    to: "/annuaire?pays=Burkina+Faso",
  },
  {
    icon: Orbit,
    label: "Par disponibilité",
    value: "Mentorat ouvert",
    detail: "Contacter uniquement les alumni qui ont choisi de guider un élève.",
    to: "/annuaire?mentor=true",
  },
];

export function HomePage() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector(location.hash);
    window.setTimeout(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [location.hash]);

  return (
    <>
      <Hero />

      <section className="network-ribbon" aria-label="Promesse du réseau">
        <div className="page-shell network-ribbon__inner">
          <p>Un annuaire construit autour des parcours, pas des titres.</p>
          <div aria-hidden="true" className="network-ribbon__route">
            <span>Bobo-Dioulasso</span><i />
            <span>Ouagadougou</span><i />
            <span>Dakar</span><i />
            <span>le monde</span>
          </div>
        </div>
      </section>

      <section id="reseau" className="section featured-section">
        <div className="page-shell">
          <Reveal className="section-heading section-heading--split">
            <div>
              <p className="eyebrow eyebrow--dark">Parcours en lumière</p>
              <h2>Des chemins différents.<br />Des repères partageables.</h2>
            </div>
            <div>
              <p>
                Chaque profil raconte les décisions, les transitions et les spécialités qui
                ne tiennent pas sur un simple intitulé de poste.
              </p>
              <span className="demo-note">Profils fictifs présentés pour la maquette.</span>
            </div>
          </Reveal>

          <div className="featured-grid">
            <Reveal className="featured-grid__primary">
              <AlumniCard profile={alumniProfiles[0]!} featured />
            </Reveal>
            <Reveal delay={90}>
              <AlumniCard profile={alumniProfiles[1]!} />
            </Reveal>
            <Reveal delay={160}>
              <AlumniCard profile={alumniProfiles[3]!} />
            </Reveal>
          </div>

          <div className="section-link-row">
            <Link to="/annuaire" className="text-link">
              Parcourir tous les profils <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="section discovery-section" aria-labelledby="discovery-title">
        <div className="page-shell discovery-section__layout">
          <Reveal className="discovery-section__intro">
            <p className="eyebrow">Trouver le bon point de contact</p>
            <h2 id="discovery-title">Chercher par ce qui compte vraiment.</h2>
            <p>
              Une recherche directe par spécialité, domaine, pays ou disponibilité au mentorat.
              Le diplôme pourra être ajouté plus tard sans alourdir l’expérience actuelle.
            </p>
            <ButtonLink to="/annuaire" variant="light">
              Ouvrir l’annuaire <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
          </Reveal>

          <div className="discovery-paths">
            {discoveryPaths.map((path, index) => {
              const Icon = path.icon;
              return (
                <Reveal key={path.label} delay={index * 80}>
                  <Link to={path.to} className="discovery-path">
                    <span className="discovery-path__index">0{index + 1}</span>
                    <Icon aria-hidden="true" />
                    <div>
                      <p>{path.label}</p>
                      <h3>{path.value}</h3>
                      <span>{path.detail}</span>
                    </div>
                    <ArrowRight aria-hidden="true" className="discovery-path__arrow" />
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section id="mentorat" className="section mentoring-section" aria-labelledby="mentoring-title">
        <div className="page-shell mentoring-section__grid">
          <Reveal className="mentoring-section__image-wrap">
            <img
              src="/images/mentoring-lab.jpg"
              alt="Illustration éditoriale de trois jeunes Burkinabè échangeant dans un laboratoire scolaire"
              className="mentoring-section__image"
            />
            <p className="mentoring-section__image-note">Visuel original généré pour le projet</p>
          </Reveal>

          <Reveal className="mentoring-section__copy" delay={80}>
            <p className="eyebrow eyebrow--dark">Mentorat volontaire</p>
            <h2 id="mentoring-title">Des conseils.<br />Pas des promesses.</h2>
            <p>
              Un élève peut demander un échange à un ancien qui s’est déclaré disponible. Le but
              est simple&nbsp;: comprendre une filière, préparer un choix et éviter d’avancer seul.
            </p>

            <ol className="mentoring-steps">
              <li>
                <span>01</span>
                <div><b>Découvrir</b><p>Lire un parcours et ses spécialités.</p></div>
              </li>
              <li>
                <span>02</span>
                <div><b>Demander</b><p>Expliquer en quelques lignes ce dont on a besoin.</p></div>
              </li>
              <li>
                <span>03</span>
                <div><b>Échanger</b><p>Le mentor accepte selon sa disponibilité.</p></div>
              </li>
            </ol>

            <div className="mentoring-section__actions">
              <ButtonLink to="/annuaire?mentor=true">
                Trouver un mentor <MessageCircle size={18} aria-hidden="true" />
              </ButtonLink>
              <Link to="/rejoindre?mentorat=true" className="text-link text-link--dark">
                Devenir mentor <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section roots-section" aria-labelledby="roots-title">
        <div className="page-shell">
          <Reveal className="roots-section__headline">
            <p className="eyebrow">Notre point commun</p>
            <h2 id="roots-title">La science pour élan.<br />Sya pour ancrage.</h2>
          </Reveal>

          <div className="roots-section__gallery">
            <Reveal className="roots-photo roots-photo--school">
              <img
                src="https://www.lobspaalga.com/wp-content/uploads/2023/07/IMG-20210921-WA0003-840x480-1-780x470.jpg"
                alt="Entrée du Lycée Scientifique National de Bobo-Dioulasso"
                loading="lazy"
              />
              <div>
                <span>Le point de départ</span>
                <p>Lycée Scientifique National de Bobo-Dioulasso</p>
                <a
                  href="https://www.lobspaalga.com/2023/07/02/lycee-scientifique-de-bobo-pas-de-frais-de-scolarite-pour-les-eleves/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Photo&nbsp;: L’Obs Paalga
                </a>
              </div>
            </Reveal>

            <Reveal className="roots-photo roots-photo--city" delay={90}>
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/BoboDioulasso-GrandMosqueN.JPG/1200px-BoboDioulasso-GrandMosqueN.JPG"
                alt="Grande Mosquée de Bobo-Dioulasso, exemple d’architecture soudano-sahélienne"
                loading="lazy"
              />
              <div>
                <span>L’identité de Sya</span>
                <p>Ocre du banco, indigo, vert manguier et lumière blanche.</p>
                <a
                  href="https://commons.wikimedia.org/wiki/File:BoboDioulasso-GrandMosqueN.JPG"
                  target="_blank"
                  rel="noreferrer"
                >
                  Photo&nbsp;: Semiliki · CC BY-SA
                </a>
              </div>
            </Reveal>
          </div>

          <Reveal className="roots-section__manifesto">
            <Compass aria-hidden="true" />
            <p>
              Le réseau n’efface pas les distances&nbsp;: il les transforme en chemins que les
              suivants peuvent lire.
            </p>
            <BookOpen aria-hidden="true" />
          </Reveal>
        </div>
      </section>

      <section className="join-cta">
        <div className="page-shell join-cta__inner">
          <div>
            <p className="eyebrow">Élève ou alumni</p>
            <h2>Ajoutez votre trajectoire<br />à la carte.</h2>
          </div>
          <div>
            <p>
              Créez un profil clair, partagez votre parcours et choisissez librement si vous
              souhaitez proposer du mentorat.
            </p>
            <ButtonLink to="/rejoindre" variant="light" size="lg">
              Créer mon profil <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
