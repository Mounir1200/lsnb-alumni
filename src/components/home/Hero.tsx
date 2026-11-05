import { animate, stagger } from "animejs";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { heroActions } from "../../lib/heroActions";
import { SITE_ORIGIN } from "../../lib/site";
import { ButtonLink } from "../ui/Button";
import { TrajectoryField } from "../visual/TrajectoryField";
import { HeroSearch } from "./HeroSearch";

export function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const { user, isLoading } = useAuth();
  const actions = heroActions({ isVisitor: !isLoading && !user });

  useEffect(() => {
    if (!rootRef.current || reducedMotion) return;
    const targets = rootRef.current.querySelectorAll<HTMLElement>("[data-hero-enter]");
    const titleWords = rootRef.current.querySelectorAll<HTMLElement>("[data-hero-word]");
    const entranceAnimation = animate(targets, {
      opacity: [0.68, 1],
      translateY: [26, 0],
      duration: 900,
      delay: stagger(90, { start: 80 }),
      ease: "outExpo",
    });
    const titleAnimation = animate(titleWords, {
      opacity: [0.35, 1],
      translateY: ["108%", "0%"],
      rotate: [2.5, 0],
      duration: 1150,
      delay: stagger(115, { start: 110 }),
      ease: "outExpo",
    });

    return () => {
      entranceAnimation.revert();
      titleAnimation.revert();
    };
  }, [reducedMotion]);

  return (
    <section ref={rootRef} className="hero" aria-labelledby="hero-title">
      <div className="page-shell hero__stage">
        <div className="hero__copy">
          <p className="hero__coordinate" data-hero-enter>
            <span>{SITE_ORIGIN.latitude}</span>
            <span>{SITE_ORIGIN.longitude}</span>
            <b>Sya, Burkina Faso</b>
          </p>
          <h1 id="hero-title">
            <span className="hero__title-line">
              <span data-hero-word>Partir</span> <span data-hero-word>loin.</span>
            </span>
            <span className="hero__title-line hero__title-line--accent">
              <span data-hero-word>Rester</span> <span data-hero-word>reliés.</span>
            </span>
          </h1>
          <p className="hero__intro" data-hero-enter>
            Le réseau des élèves et alumni du Lycée Scientifique National de
            Bobo-Dioulasso. Des parcours concrets, des conseils accessibles, un même point
            de départ.
          </p>
          <div className="hero__actions" data-hero-enter>
            <ButtonLink to={actions.primary.to} variant="light" size="lg">
              {actions.primary.label} <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
            <Link to={actions.secondary.to} className="text-link text-link--light text-link--action">
              {actions.secondary.label} <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="hero__visual" data-hero-enter>
          <TrajectoryField />
          <p className="hero__visual-note">
            <span>Une origine</span>
            <strong>des trajectoires multiples</strong>
          </p>
        </div>
      </div>

      <HeroSearch />
    </section>
  );
}
