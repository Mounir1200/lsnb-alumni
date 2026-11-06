import { BOBO_DIOULASSO, findPlace, isNearSchool, type Coordinates } from "../data/places";
import type { CareerStep } from "./careerSteps";

/** A place of the member's path, as drawn on the profile globe. */
export type TrajectoryStop = { name: string; coordinates: Coordinates };

/** Beyond this many places after the school, the globe and its caption stop being readable. */
export const MAX_TRAJECTORY_STOPS = 6;

export const SCHOOL_STOP: TrajectoryStop = { name: "Bobo-Dioulasso", coordinates: BOBO_DIOULASSO };

/**
 * "Angers, France", "Sfax / Tunisie", "Sousse - Tunisie", "Poitiers (France)":
 * the first part names the city, the last the country; a single word may be either.
 */
function splitLocation(location: string) {
  const parts = location.split(/[,/;|()–—]|\s-\s/).map((part) => part.trim()).filter(Boolean);
  return { city: parts[0] ?? "", country: parts.at(-1) ?? "" };
}

function toStop(city: string, country: string): TrajectoryStop | undefined {
  const place = findPlace(city, country);
  if (!place) return undefined;
  if (isNearSchool(place.coordinates)) return SCHOOL_STOP;
  return { name: place.precision === "city" ? city : country, coordinates: place.coordinates };
}

/** True when the member lives in or around Bobo-Dioulasso, where every path starts. */
export function livesAtOrigin(city: string, country: string): boolean {
  const place = findPlace(city, country);
  return place !== undefined && isNearSchool(place.coordinates);
}

const placeKey = ({ coordinates }: TrajectoryStop) => `${coordinates.latitude},${coordinates.longitude}`;

/**
 * The places after the school, oldest first: each career step's location, then
 * where the member lives today. Unknown places are skipped and consecutive
 * repeats merged, so a return to Bobo-Dioulasso still shows as a last leg.
 */
export function toTrajectoryStops(careerSteps: CareerStep[], city: string, country: string): TrajectoryStop[] {
  const places = [...careerSteps.map((step) => splitLocation(step.location)), { city, country }];
  const stops = places.reduce<TrajectoryStop[]>((path, place) => {
    const stop = toStop(place.city, place.country);
    return stop && placeKey(stop) !== placeKey(path.at(-1) ?? SCHOOL_STOP) ? [...path, stop] : path;
  }, []);
  return stops.slice(-MAX_TRAJECTORY_STOPS);
}
