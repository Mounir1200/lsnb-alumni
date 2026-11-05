import { BOBO_DIOULASSO, findPlace, isNearSchool, type Coordinates } from "../data/places";
import type { CareerStep } from "./careerSteps";

/** A place of the member's path, as drawn on the profile globe. */
export type TrajectoryStop = { name: string; coordinates: Coordinates };

/** Beyond this many places after the school, the globe and its caption stop being readable. */
export const MAX_TRAJECTORY_STOPS = 6;

export const SCHOOL_STOP: TrajectoryStop = { name: "Bobo-Dioulasso", coordinates: BOBO_DIOULASSO };

/** "Angers, France" gives a city and a country; a single word may be either. */
function splitLocation(location: string) {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  const country = parts.at(-1) ?? "";
  return { city: parts.length > 1 ? parts.slice(0, -1).join(", ") : country, country };
}

function toStop(city: string, country: string): TrajectoryStop | undefined {
  const place = findPlace(city, country);
  if (!place) return undefined;
  if (isNearSchool(place.coordinates)) return SCHOOL_STOP;
  return { name: place.precision === "city" ? city : country, coordinates: place.coordinates };
}

function isSamePlace(first: TrajectoryStop, second: TrajectoryStop) {
  return first.coordinates.latitude === second.coordinates.latitude
    && first.coordinates.longitude === second.coordinates.longitude;
}

/**
 * The places after the school, oldest first: each career step's location, then
 * where the member lives today. Unknown places are skipped and consecutive
 * repeats merged, so a return to Bobo-Dioulasso still shows as a last leg.
 */
export function toTrajectoryStops(careerSteps: CareerStep[], city: string, country: string): TrajectoryStop[] {
  const places = [...careerSteps.map((step) => splitLocation(step.location)), { city, country }];
  const stops = places.reduce<TrajectoryStop[]>((path, place) => {
    const stop = toStop(place.city, place.country);
    return stop && !isSamePlace(stop, path.at(-1) ?? SCHOOL_STOP) ? [...path, stop] : path;
  }, []);
  return stops.slice(-MAX_TRAJECTORY_STOPS);
}
