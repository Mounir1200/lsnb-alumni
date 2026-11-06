import { ArrowRight } from "lucide-react";
import type { AlumniProfile } from "../../data/alumni";
import { findPlace, isNearSchool } from "../../data/places";
import { SCHOOL_STOP, toTrajectoryStops } from "../../lib/trajectory";
import { TrajectoryGlobe } from "../visual/TrajectoryGlobe";

type ProfileTrajectoryProps = Pick<AlumniProfile, "city" | "country" | "careerSteps">;

/** Hero globe: the route from the LSNB through each place of the member's path; the caption names where it ends. */
export function ProfileTrajectory({ city, country, careerSteps }: ProfileTrajectoryProps) {
  const stops = toTrajectoryStops(careerSteps, city, country);
  const currentPlace = findPlace(city, country);
  const isAtSchool = currentPlace ? isNearSchool(currentPlace.coordinates) : false;

  const destination = stops.at(-1);

  const caption = destination ? (
    <>
      <span className="trajectory-globe__route">
        {SCHOOL_STOP.name}
        <ArrowRight size={15} aria-hidden="true" /><span className="sr-only">vers</span> {destination.name}
      </span>
      <span className="trajectory-globe__note">Du LSNB à aujourd’hui</span>
    </>
  ) : (
    <>
      <span className="trajectory-globe__route">{SCHOOL_STOP.name}</span>
      <span className="trajectory-globe__note">{isAtSchool ? "Toujours dans la ville du LSNB" : "Point de départ : le LSNB"}</span>
    </>
  );

  return (
    <TrajectoryGlobe
      origin={SCHOOL_STOP.coordinates}
      destinations={stops.map((stop) => stop.coordinates)}
      caption={caption}
    />
  );
}
