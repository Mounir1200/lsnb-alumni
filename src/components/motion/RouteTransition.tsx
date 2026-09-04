import { animate } from "animejs";
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useReducedMotion } from "../../hooks/useReducedMotion";

export function RouteTransition({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!ref.current || reducedMotion) return;

    animate(ref.current, {
      opacity: [0.78, 1],
      translateY: [8, 0],
      duration: 420,
      ease: "outQuad",
    });
  }, [location.pathname, reducedMotion]);

  return <div ref={ref}>{children}</div>;
}
