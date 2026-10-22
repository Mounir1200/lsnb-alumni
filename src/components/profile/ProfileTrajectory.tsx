import { ArrowRight } from "lucide-react";
import { BOBO_DIOULASSO, findPlace, isNearSchool } from "../../data/places";
import { TrajectoryGlobe } from "../visual/TrajectoryGlobe";

/** Hero globe: the route from the LSNB to where the member lives today. */
export function ProfileTrajectory({ city, country }: { city: string; country: string }) {
  const place = findPlace(city, country);
  const isAtSchool = place ? isNearSchool(place.coordinates) : false;
  const destination = place && !isAtSchool ? place.coordinates : undefined;
  const destinationName = place?.precision === "city" ? city : country;

  const caption = destination ? (
    <>
      <span className="trajectory-globe__route">
        Bobo-Dioulasso <ArrowRight size={15} aria-hidden="true" /><span className="sr-only">vers</span> {destinationName}
      </span>
      <span className="trajectory-globe__note">Du LSNB à aujourd’hui</span>
    </>
  ) : (
    <>
      <span className="trajectory-globe__route">Bobo-Dioulasso</span>
      <span className="trajectory-globe__note">{isAtSchool ? "Toujours dans la ville du LSNB" : "Point de départ : le LSNB"}</span>
    </>
  );

  return <TrajectoryGlobe origin={BOBO_DIOULASSO} destination={destination} caption={caption} />;
}
