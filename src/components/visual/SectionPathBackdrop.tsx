import { animate, createScope, stagger, svg } from "animejs";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { cn } from "../../lib/cn";

type SectionPathBackdropProps = {
  variant: "profiles" | "roots";
};

function ProfilesArtwork() {
  return (
    <svg viewBox="0 0 1440 920" preserveAspectRatio="none">
      <g className="section-path-backdrop__grid">
        <path d="M0 170H1440M0 430H1440M0 690H1440" />
        <path d="M240 0V920M720 0V920M1200 0V920" />
      </g>

      <g className="section-path-backdrop__rings">
        <circle cx="118" cy="772" r="96" />
        <circle cx="118" cy="772" r="154" />
      </g>

      <g className="section-path-backdrop__routes">
        <path
          data-draw-path
          data-motion-path
          d="M118 772C258 525 392 410 612 350S1010 260 1510 96"
        />
        <path
          data-draw-path
          data-motion-path
          d="M118 772C330 692 435 570 682 558S1064 622 1510 458"
        />
        <path
          data-draw-path
          data-motion-path
          d="M118 772C292 824 544 760 760 700S1112 750 1510 856"
        />
      </g>

      <g className="section-path-backdrop__nodes">
        <circle data-path-node cx="118" cy="772" r="7" />
        <circle data-path-node cx="408" cy="405" r="5" />
        <circle data-path-node cx="682" cy="558" r="5" />
        <circle data-path-node cx="760" cy="700" r="5" />
        <circle data-path-node cx="1046" cy="254" r="4" />
        <circle data-path-node cx="1118" cy="621" r="4" />
      </g>

      <g className="section-path-backdrop__travelers">
        <circle data-path-traveler r="5" />
        <circle data-path-traveler r="5" />
        <circle data-path-traveler r="5" />
      </g>
    </svg>
  );
}

function RootsArtwork() {
  return (
    <svg viewBox="0 0 1440 980" preserveAspectRatio="none">
      <g className="section-path-backdrop__rings">
        <circle cx="1160" cy="238" r="112" />
        <circle cx="1160" cy="238" r="190" />
        <circle cx="1160" cy="238" r="268" />
      </g>

      <g className="section-path-backdrop__routes">
        <path
          data-draw-path
          data-motion-path
          d="M-90 346C260 144 504 480 750 282S1150 116 1510 338"
        />
        <path
          data-draw-path
          data-motion-path
          d="M-80 705C244 522 540 770 820 592S1190 458 1510 594"
        />
      </g>

      <g className="section-path-backdrop__architecture">
        <path
          data-draw-path
          d="M80 880V670L130 612L180 670V880M108 646V548L130 510L152 548V646"
        />
        <path
          data-draw-path
          d="M1060 812V536L1124 452L1188 536V812M1096 488V350L1124 294L1152 350V488"
        />
        <path
          data-draw-path
          d="M770 862V690L816 632L862 690V862M794 660V582L816 542L838 582V660"
        />
        <path
          data-draw-path
          d="M12 881H1428M24 846l42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30 42-30 42 30"
        />
      </g>

      <g className="section-path-backdrop__nodes">
        <circle data-path-node cx="130" cy="612" r="6" />
        <circle data-path-node cx="498" cy="365" r="5" />
        <circle data-path-node cx="816" cy="632" r="5" />
        <circle data-path-node cx="1124" cy="452" r="6" />
        <circle data-path-node cx="1260" cy="520" r="4" />
      </g>

      <g className="section-path-backdrop__travelers">
        <circle data-path-traveler r="5" />
        <circle data-path-traveler r="5" />
      </g>
    </svg>
  );
}

export function SectionPathBackdrop({ variant }: SectionPathBackdropProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion) return;

    let animationScope: ReturnType<typeof createScope> | null = null;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || animationScope) return;

        animationScope = createScope({ root }).add(() => {
          const drawPaths = Array.from(
            root.querySelectorAll<SVGPathElement>("[data-draw-path]"),
          );
          const motionPaths = Array.from(
            root.querySelectorAll<SVGPathElement>("[data-motion-path]"),
          );
          const travelers = Array.from(
            root.querySelectorAll<SVGCircleElement>("[data-path-traveler]"),
          );
          const nodes = root.querySelectorAll<SVGCircleElement>("[data-path-node]");
          const rings = root.querySelectorAll<SVGCircleElement>(
            ".section-path-backdrop__rings circle",
          );

          const drawables = drawPaths.flatMap((path) => svg.createDrawable(path));
          animate(drawables, {
            draw: ["0 0", "0 1"],
            duration: 2300,
            delay: stagger(140),
            ease: "inOutCubic",
          });

          motionPaths.forEach((path, index) => {
            const traveler = travelers[index];
            if (!traveler) return;

            animate(traveler, {
              ...svg.createMotionPath(path),
              duration: 11200 + index * 1900,
              delay: 360 + index * 720,
              loop: true,
              ease: "linear",
            });
          });

          animate(nodes, {
            opacity: [0.36, 0.92],
            scale: [0.72, 1.28],
            duration: 2200,
            delay: stagger(230),
            alternate: true,
            loop: true,
            ease: "inOutSine",
          });

          animate(rings, {
            rotate: [0, 360],
            duration: 32000,
            delay: stagger(800),
            loop: true,
            ease: "linear",
          });
        });

        observer.disconnect();
      },
      { rootMargin: "12% 0px", threshold: 0.08 },
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
      animationScope?.revert();
    };
  }, [reducedMotion, variant]);

  return (
    <div
      ref={rootRef}
      className={cn("section-path-backdrop", `section-path-backdrop--${variant}`)}
      aria-hidden="true"
    >
      {variant === "profiles" ? <ProfilesArtwork /> : <RootsArtwork />}
    </div>
  );
}
