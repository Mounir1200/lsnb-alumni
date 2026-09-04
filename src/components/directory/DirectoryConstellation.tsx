import { useState } from "react";
import { Link } from "react-router-dom";
import { alumniProfiles } from "../../data/alumni";
import { useReducedMotion } from "../../hooks/useReducedMotion";

const constellationProfiles = [
  { profile: alumniProfiles[0]!, position: "north", route: "route-aicha" },
  { profile: alumniProfiles[1]!, position: "east", route: "route-karim" },
  { profile: alumniProfiles[3]!, position: "west", route: "route-moussa" },
  { profile: alumniProfiles[4]!, position: "south", route: "route-fanta" },
];

const routes = [
  { id: "route-aicha", path: "M 308 222 Q 342 110 430 74", duration: "5.8s", begin: "-1.2s" },
  { id: "route-karim", path: "M 308 222 Q 442 174 548 214", duration: "6.7s", begin: "-3.8s" },
  { id: "route-moussa", path: "M 308 222 Q 232 284 132 320", duration: "6.2s", begin: "-2.4s" },
  { id: "route-fanta", path: "M 308 222 Q 350 324 446 365", duration: "7.1s", begin: "-5.1s" },
];

export function DirectoryConstellation() {
  const reducedMotion = useReducedMotion();
  const [activeRoute, setActiveRoute] = useState<string | null>(null);

  return (
    <div className="directory-constellation" data-active-route={activeRoute ?? undefined}>
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

      {constellationProfiles.map(({ profile, position, route }) => (
        <Link
          key={profile.id}
          to={`/alumni/${profile.id}`}
          className={`directory-constellation__profile directory-constellation__profile--${position}`}
          onPointerEnter={() => setActiveRoute(route)}
          onPointerLeave={() => setActiveRoute(null)}
          onFocus={() => setActiveRoute(route)}
          onBlur={() => setActiveRoute(null)}
          aria-label={`Découvrir le parcours fictif de ${profile.firstName} ${profile.lastName}`}
        >
          <img src={profile.photoUrl} alt="" />
          <span>
            <b>{profile.firstName}</b>
            {profile.domain}
          </span>
        </Link>
      ))}
    </div>
  );
}
