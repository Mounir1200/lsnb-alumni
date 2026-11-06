import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type RouteStopProps = {
  children: ReactNode;
  /** "light" on dark sections, "dark" on light ones. */
  tone?: "light" | "dark";
};

/**
 * Opens a section as a stop on the route that runs down the page: its ochre
 * line comes down from the section's top edge to the stop.
 */
export function RouteStop({ children, tone = "dark" }: RouteStopProps) {
  return (
    <p className={cn("route-stop", tone === "light" && "route-stop--light")}>
      <span className="route-stop__node" aria-hidden="true" />
      {children}
    </p>
  );
}
