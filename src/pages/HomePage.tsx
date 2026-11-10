import {
  ArrowRight,
  BookOpen,
  Compass,
  Map,
  MessageCircle,
  Microscope,
  Orbit,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Hero } from "../components/home/Hero";
import { WeeklyHighlights } from "../components/home/WeeklyHighlights";
import { Reveal } from "../components/motion/Reveal";
import { ButtonLink } from "../components/ui/Button";
import { RouteStop } from "../components/visual/RouteStop";
import { SectionPathBackdrop } from "../components/visual/SectionPathBackdrop";
import { pickHomePhotos, type HomePhoto } from "../data/homePhotos";
import { useAudience } from "../hooks/useAudience";
import { mentoringInvitation, profileInvitation } from "../lib/invitations";

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

function PhotoCredit({ credit }: { credit: HomePhoto["credit"] }) {
  return credit.href
    ? <a href={credit.href} target="_blank" rel="noreferrer">{credit.label}</a>
    : <>{credit.label}</>;
}

export function HomePage() {
  const location = useLocation();
  // Drawn once per visit, so a photo never changes while it is being looked at.
  const [photos] = useState(() => pickHomePhotos());
  const audience = useAudience();
  const mentoring = mentoringInvitation(audience);
  const invitation = profileInvitation(audience);

  useEffect(() => {
    if (!location.hash) return;
    // Auth returns put tokens in the fragment; querySelector would throw on them.
    const target = document.getElementById(location.hash.slice(1));
    window.setTimeout(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [location.hash]);

  return (
    <>
      <Hero />

      <section id="reseau" className="network-ribbon" aria-label="Promesse du réseau">
        <div className="page-shell network-ribbon__inner">
          <p>Un annuaire construit autour des parcours, pas des titres.</p>
          <div aria-hidden="true" className="network-ribbon__route">
            <span className="network-ribbon__stop">Bobo-Dioulasso<i className="route-leg" /></span>
            <span className="network-ribbon__stop">Ouagadougou<i className="route-leg" /></span>
            <span className="network-ribbon__stop">Dakar<i className="route-leg" /></span>
            <span className="network-ribbon__stop">Le monde</span>
          </div>
        </div>
      </section>

      <WeeklyHighlights />

      <section className="section discovery-section" aria-labelledby="discovery-title">
        <div className="page-shell discovery-section__layout">
          <Reveal className="discovery-section__intro">
            <RouteStop tone="light">Trouver le bon point de contact</RouteStop>
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
              src={photos.mentoring.src}
              alt={photos.mentoring.alt}
              width={photos.mentoring.width}
              height={photos.mentoring.height}
              className="mentoring-section__image"
            />
            <p className="mentoring-section__image-note"><PhotoCredit credit={photos.mentoring.credit} /></p>
          </Reveal>

          <Reveal className="mentoring-section__copy" delay={80}>
            <RouteStop>Mentorat volontaire</RouteStop>
            <h2 id="mentoring-title">Des conseils.<br />Pas des promesses.</h2>
            <p>
              Un élève peut demander un échange à un ancien qui s’est déclaré disponible. Le but
              est simple&nbsp;: comprendre une filière, préparer un choix et éviter d’avancer seul.
            </p>

            <ol className="mentoring-steps route-steps">
              <li><div><b>Découvrir</b><p>Lire un parcours et ses spécialités.</p></div></li>
              <li><div><b>Demander</b><p>Expliquer en quelques lignes ce dont on a besoin.</p></div></li>
              <li><div><b>Échanger</b><p>Le mentor accepte selon sa disponibilité.</p></div></li>
            </ol>

            <div className="mentoring-section__actions">
              <ButtonLink to="/annuaire?mentor=true">
                Trouver un mentor <MessageCircle size={18} aria-hidden="true" />
              </ButtonLink>
              {mentoring && (
                <Link to={mentoring.to} className="text-link text-link--action">
                  {mentoring.label} <ArrowRight size={17} aria-hidden="true" />
                </Link>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="ancrage" className="section roots-section" aria-labelledby="roots-title">
        <SectionPathBackdrop variant="roots" />
        <div className="page-shell">
          <Reveal className="roots-section__headline">
            <RouteStop>Notre point commun</RouteStop>
            <h2 id="roots-title">La science pour élan.<br />Sya pour ancrage.</h2>
          </Reveal>

          <div className="roots-section__gallery">
            <Reveal className="roots-photo roots-photo--school">
              <img
                src={photos.school.src}
                alt={photos.school.alt}
                width={photos.school.width}
                height={photos.school.height}
                loading="lazy"
              />
              <div>
                <span>Le point de départ</span>
                <p>Lycée Scientifique National de Bobo-Dioulasso</p>
                <PhotoCredit credit={photos.school.credit} />
              </div>
            </Reveal>

            <Reveal className="roots-photo roots-photo--city" delay={90}>
              <img
                src={photos.city.src}
                alt={photos.city.alt}
                loading="lazy"
                decoding="async"
                width={photos.city.width}
                height={photos.city.height}
              />
              <div>
                <span>L’identité de Sya</span>
                <p>Ocre du banco, indigo, vert manguier et lumière blanche.</p>
                <PhotoCredit credit={photos.city.credit} />
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
            <RouteStop tone="light">{invitation.eyebrow}</RouteStop>
            <h2>{invitation.title[0]}<br />{invitation.title[1]}</h2>
          </div>
          <div>
            <p>{invitation.text}</p>
            <ButtonLink to={invitation.action.to} variant="light" size="lg">
              {invitation.action.label} <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
