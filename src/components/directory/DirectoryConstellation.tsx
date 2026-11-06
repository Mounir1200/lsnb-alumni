import { UserRound } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { AlumniProfile } from "../../data/alumni";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { pickDirectoryPortraits } from "../../lib/directoryPortraits";

// The four places around Bobo-Dioulasso, each reached by its own route.
const places = [
  { position: "north", route: "route-north" },
  { position: "east", route: "route-east" },
  { position: "west", route: "route-west" },
  { position: "south", route: "route-south" },
] as const;

const routes = [
  { id: "route-north", path: "M 308 222 Q 342 110 430 74", duration: "5.8s", begin: "-1.2s" },
  { id: "route-east", path: "M 308 222 Q 442 174 548 214", duration: "6.7s", begin: "-3.8s" },
  { id: "route-west", path: "M 308 222 Q 232 284 132 320", duration: "6.2s", begin: "-2.4s" },
  { id: "route-south", path: "M 308 222 Q 350 324 446 365", duration: "7.1s", begin: "-5.1s" },
];

type DirectoryConstellationProps = {
  /** The members the directory loaded; until they arrive, every place waits. */
  profiles: AlumniProfile[];
  /** Lets the page ask a visitor to sign in before a profile opens, as on the cards. */
  onProfileClick?: (event: MouseEvent<HTMLDivElement>) => void;
};

/** Members with a photo, drawn at random around the school town; empty places wait for the next photos. */
export function DirectoryConstellation({ profiles, onProfileClick }: DirectoryConstellationProps) {
  const reducedMotion = useReducedMotion();
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  // Drawn again when the directory reloads, never while its filters change.
  const slots = useMemo(() => pickDirectoryPortraits(profiles), [profiles]);

  return (
    <div className="directory-constellation" data-active-route={activeRoute ?? undefined} onClickCapture={onProfileClick}>
      <svg
        className="directory-constellation__routes"
        viewBox="0 0 620 430"
        aria-hidden="true"
      >
        <circle className="directory-constellation__orbit" cx="308" cy="222" r="145" />
        <circle className="directory-constellation__orbit directory-constellation__orbit--outer" cx="308" cy="222" r="205" />
        {routes.map((route) => (
          <g key={route.id}>
            <path id={route.id} className={`directory-constellation__route ${route.id}`} d={route.path} />
            {!reducedMotion && (
              <circle className="directory-constellation__signal" r="4">
                <animateMotion
                  path={route.path}
                  dur={route.duration}
                  begin={route.begin}
                  repeatCount="indefinite"
                />
              </circle>
            )}
          </g>
        ))}
      </svg>

      <div className="directory-constellation__origin" aria-hidden="true">
        <i />
        <span><b>Origine</b>Bobo-Dioulasso</span>
      </div>

      {slots.map((slot, index) => {
        const { position, route } = places[index]!;
        const placeClass = `directory-constellation__profile directory-constellation__profile--${position}`;
        if (slot.kind === "placeholder") {
          return (
            <div key={position} className={`${placeClass} is-placeholder`} aria-hidden="true">
              <div className="directory-constellation__holder"><UserRound size={28} strokeWidth={1.5} /></div>
              <span><b>Votre portrait</b>bientôt ici</span>
            </div>
          );
        }
        const { profile } = slot;
        const name = `${profile.firstName} ${profile.lastName}`;
        return (
          <Link
            key={position}
            to={`/alumni/${profile.id}`}
            className={placeClass}
            onPointerEnter={() => setActiveRoute(route)}
            onPointerLeave={() => setActiveRoute(null)}
            onFocus={() => setActiveRoute(route)}
            onBlur={() => setActiveRoute(null)}
            aria-label={profile.isDemo === false ? `Découvrir le parcours de ${name}` : `Découvrir le parcours fictif de ${name}`}
          >
            <img src={profile.photoUrl} alt="" />
            <span>
              <b>{profile.firstName}</b>
              {profile.domain}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
