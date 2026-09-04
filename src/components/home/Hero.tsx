import { animate, stagger } from "animejs";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { ButtonLink } from "../ui/Button";
import { TrajectoryField } from "../visual/TrajectoryField";
import { HeroSearch } from "./HeroSearch";

export function Hero() {
  const rootRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();

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
      entranceAnimation.cancel();
      titleAnimation.cancel();
    };
  }, [reducedMotion]);

  return (
    <section ref={rootRef} className="hero" aria-labelledby="hero-title">
      <div className="page-shell hero__stage">
        <div className="hero__copy">
          <p className="hero__coordinate" data-hero-enter>
            <span>11.1771° N</span>
            <span>4.2979° W</span>
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
            <ButtonLink to="/annuaire" variant="light" size="lg">
              Explorer l’annuaire <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
            <ButtonLink to="/rejoindre?mentorat=true" variant="ghost" size="lg">
              Proposer un mentorat <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
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
