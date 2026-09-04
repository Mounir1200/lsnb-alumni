import { animate, createScope, stagger, svg } from "animejs";
import { useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";

type AlumniCardMotionProps = {
  profileId: string;
};

const pathVariants = [
  {
    routes: [
      "M-36 420C72 304 154 452 244 316S354 126 470 150",
      "M176 520C194 402 260 388 320 302S404 216 476 252",
    ],
    ring: { cx: 392, cy: 438, r: 122 },
    nodes: [
      [244, 316],
      [320, 302],
      [384, 192],
    ],
  },
  {
    routes: [
      "M-42 178C98 76 176 176 220 280S338 468 470 388",
      "M56 520C118 392 166 350 250 320S360 268 474 76",
    ],
    ring: { cx: 38, cy: 66, r: 112 },
    nodes: [
      [220, 280],
      [250, 320],
      [360, 268],
    ],
  },
  {
    routes: [
      "M-46 360C98 422 142 208 260 250S362 340 470 188",
      "M96-28C142 108 238 90 288 190S342 390 472 442",
    ],
    ring: { cx: 414, cy: 410, r: 148 },
    nodes: [
      [142, 286],
      [260, 250],
      [342, 352],
    ],
  },
] as const;

function getVariantIndex(profileId: string) {
  return [...profileId].reduce((total, character) => total + character.charCodeAt(0), 0)
    % pathVariants.length;
}

export function AlumniCardMotion({ profileId }: AlumniCardMotionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const variant = useMemo(() => pathVariants[getVariantIndex(profileId)]!, [profileId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reducedMotion) return;

    let animationScope: ReturnType<typeof createScope> | null = null;
    const ambientAnimations: ReturnType<typeof animate>[] = [];

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        if (animationScope) {
          ambientAnimations.forEach((animation) => {
            if (entry.isIntersecting) animation.play();
            else animation.pause();
          });
          return;
        }

        if (!entry.isIntersecting) return;

        animationScope = createScope({ root }).add(() => {
          const routes = Array.from(
            root.querySelectorAll<SVGPathElement>("[data-card-route]"),
          );
          const travelers = Array.from(
            root.querySelectorAll<SVGCircleElement>("[data-card-traveler]"),
          );
          const nodes = root.querySelectorAll<SVGCircleElement>("[data-card-node]");
          const ring = root.querySelector<SVGCircleElement>("[data-card-ring]");

          animate(routes.flatMap((route) => svg.createDrawable(route)), {
            draw: ["0 0", "0 1"],
            duration: 1600,
            delay: stagger(180),
            ease: "inOutCubic",
          });

          routes.forEach((route, index) => {
            const traveler = travelers[index];
            if (!traveler) return;

            ambientAnimations.push(animate(traveler, {
              ...svg.createMotionPath(route),
              duration: 8200 + index * 1700,
              delay: index * 540,
              loop: true,
              ease: "linear",
            }));
          });

          ambientAnimations.push(animate(nodes, {
            opacity: [0.3, 0.88],
            scale: [0.78, 1.24],
            duration: 1900,
            delay: stagger(260),
            alternate: true,
            loop: true,
            ease: "inOutSine",
          }));

          if (ring) {
            ambientAnimations.push(animate(ring, {
              rotate: [0, 360],
              duration: 26000,
              loop: true,
              ease: "linear",
            }));
          }
        });
      },
      { rootMargin: "80px 0px", threshold: 0.12 },
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
      animationScope?.revert();
    };
  }, [reducedMotion, variant]);

  return (
    <div ref={rootRef} className="alumni-card-motion" aria-hidden="true">
      <svg viewBox="0 0 420 480" preserveAspectRatio="none">
        <circle
          data-card-ring
          className="alumni-card-motion__ring"
          cx={variant.ring.cx}
          cy={variant.ring.cy}
          r={variant.ring.r}
        />

        <g className="alumni-card-motion__routes">
          {variant.routes.map((route) => (
            <path key={route} data-card-route d={route} />
          ))}
        </g>

        <g className="alumni-card-motion__nodes">
          {variant.nodes.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} data-card-node cx={cx} cy={cy} r="4" />
          ))}
        </g>

        <g className="alumni-card-motion__travelers">
          {variant.routes.map((route) => (
            <circle key={route} data-card-traveler r="4.5" />
          ))}
        </g>
      </svg>
    </div>
  );
}
