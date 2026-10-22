import { normalizeSearchText } from "../lib/searchText";

export type Coordinates = { latitude: number; longitude: number };
export type Place = { coordinates: Coordinates; precision: "city" | "country" };

type PlaceEntry = [names: string[], latitude: number, longitude: number];

export const BOBO_DIOULASSO: Coordinates = { latitude: 11.18, longitude: -4.3 };
const SCHOOL_TOWN_RADIUS_KM = 150;
const EARTH_RADIUS_KM = 6371;

// Approximate city centres, enough to draw a trajectory, never shown as data.
const cities: PlaceEntry[] = [
  [["Bobo-Dioulasso", "Bobo"], 11.18, -4.3],
  [["Ouagadougou", "Ouaga"], 12.37, -1.52],
  [["Koudougou"], 12.25, -2.36],
  [["Banfora"], 10.63, -4.76],
  [["Paris"], 48.86, 2.35],
  [["Lyon"], 45.76, 4.84],
  [["Marseille"], 43.3, 5.37],
  [["Toulouse"], 43.6, 1.44],
  [["Bordeaux"], 44.84, -0.58],
  [["Lille"], 50.63, 3.06],
  [["Grenoble"], 45.19, 5.72],
  [["Strasbourg"], 48.57, 7.75],
  [["Nantes"], 47.22, -1.55],
  [["Angers"], 47.47, -0.55],
  [["Rennes"], 48.11, -1.68],
  [["Montpellier"], 43.61, 3.88],
  [["Nice"], 43.7, 7.27],
  [["Montréal", "Montreal"], 45.5, -73.57],
  [["Québec", "Quebec"], 46.81, -71.21],
  [["Ottawa"], 45.42, -75.7],
  [["Toronto"], 43.65, -79.38],
  [["Dakar"], 14.72, -17.47],
  [["Abidjan"], 5.36, -4.01],
  [["Bamako"], 12.64, -8.0],
  [["Niamey"], 13.51, 2.11],
  [["Lomé", "Lome"], 6.13, 1.22],
  [["Cotonou"], 6.37, 2.39],
  [["Accra"], 5.6, -0.19],
  [["Casablanca"], 33.57, -7.59],
  [["Rabat"], 34.02, -6.84],
  [["Tunis"], 36.81, 10.18],
  [["Kigali"], -1.95, 30.06],
  [["Bruxelles", "Brussels"], 50.85, 4.35],
  [["Genève", "Geneve", "Geneva"], 46.2, 6.14],
  [["Lausanne"], 46.52, 6.63],
  [["Berlin"], 52.52, 13.4],
  [["Londres", "London"], 51.51, -0.13],
  [["New York"], 40.71, -74.01],
];

// One representative city per country, used when the city is unknown.
const countries: PlaceEntry[] = [
  [["Burkina Faso", "Burkina"], 12.37, -1.52],
  [["Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast"], 5.36, -4.01],
  [["Sénégal", "Senegal"], 14.72, -17.47],
  [["Mali"], 12.64, -8.0],
  [["Niger"], 13.51, 2.11],
  [["Togo"], 6.13, 1.22],
  [["Bénin", "Benin"], 6.37, 2.39],
  [["Ghana"], 5.6, -0.19],
  [["Nigeria", "Nigéria"], 6.52, 3.38],
  [["Guinée", "Guinee"], 9.64, -13.58],
  [["Mauritanie"], 18.08, -15.98],
  [["Tchad"], 12.13, 15.06],
  [["Cameroun", "Cameroon"], 4.05, 9.77],
  [["Gabon"], 0.42, 9.47],
  [["République démocratique du Congo", "RDC", "RD Congo"], -4.44, 15.27],
  [["Congo", "République du Congo"], -4.27, 15.28],
  [["Rwanda"], -1.95, 30.06],
  [["Kenya"], -1.29, 36.82],
  [["Éthiopie", "Ethiopie"], 9.03, 38.74],
  [["Afrique du Sud"], -26.2, 28.05],
  [["Maroc", "Morocco"], 33.57, -7.59],
  [["Algérie", "Algerie"], 36.75, 3.06],
  [["Tunisie", "Tunisia"], 36.81, 10.18],
  [["Égypte", "Egypte"], 30.04, 31.24],
  [["France"], 48.86, 2.35],
  [["Belgique", "Belgium"], 50.85, 4.35],
  [["Suisse", "Switzerland"], 46.2, 6.14],
  [["Luxembourg"], 49.61, 6.13],
  [["Allemagne", "Germany"], 52.52, 13.4],
  [["Pays-Bas", "Netherlands"], 52.37, 4.9],
  [["Espagne", "Spain"], 40.42, -3.7],
  [["Portugal"], 38.72, -9.14],
  [["Italie", "Italy"], 41.9, 12.5],
  [["Royaume-Uni", "Angleterre", "United Kingdom", "UK"], 51.51, -0.13],
  [["Irlande", "Ireland"], 53.35, -6.26],
  [["Pologne", "Poland"], 52.23, 21.01],
  [["Lituanie", "Lithuania"], 54.69, 25.28],
  [["Autriche", "Austria"], 48.21, 16.37],
  [["Suède", "Suede", "Sweden"], 59.33, 18.07],
  [["Norvège", "Norvege", "Norway"], 59.91, 10.75],
  [["Danemark", "Denmark"], 55.68, 12.57],
  [["Finlande", "Finland"], 60.17, 24.94],
  [["Russie", "Russia"], 55.76, 37.62],
  [["Turquie", "Türkiye", "Turkey"], 41.01, 28.98],
  [["Canada"], 45.5, -73.57],
  [["États-Unis", "Etats-Unis", "USA", "United States"], 40.71, -74.01],
  [["Brésil", "Bresil", "Brazil"], -23.55, -46.63],
  [["Chine", "China"], 39.9, 116.4],
  [["Japon", "Japan"], 35.68, 139.69],
  [["Corée du Sud", "Coree du Sud", "South Korea"], 37.57, 126.98],
  [["Inde", "India"], 28.61, 77.21],
  [["Émirats arabes unis", "Emirats arabes unis", "EAU", "UAE"], 25.2, 55.27],
  [["Arabie saoudite", "Saudi Arabia"], 24.71, 46.68],
  [["Qatar"], 25.29, 51.53],
  [["Australie", "Australia"], -33.87, 151.21],
];

function placeKey(value: string) {
  return normalizeSearchText(value).replace(/[’'`-]/g, " ").replace(/\s+/g, " ").trim();
}

function indexPlaces(entries: PlaceEntry[]) {
  return new Map(entries.flatMap(([names, latitude, longitude]) =>
    names.map((name) => [placeKey(name), { latitude, longitude }] as const)));
}

const cityIndex = indexPlaces(cities);
const countryIndex = indexPlaces(countries);

/** Locates a member from free-text city and country; unknown places return undefined. */
export function findPlace(city: string, country: string): Place | undefined {
  const cityCoordinates = cityIndex.get(placeKey(city));
  if (cityCoordinates) return { coordinates: cityCoordinates, precision: "city" };
  const countryCoordinates = countryIndex.get(placeKey(country));
  return countryCoordinates ? { coordinates: countryCoordinates, precision: "country" } : undefined;
}

function distanceKm(from: Coordinates, to: Coordinates) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}

/** Members still living around Bobo-Dioulasso have no journey to draw. */
export function isNearSchool(coordinates: Coordinates) {
  return distanceKm(BOBO_DIOULASSO, coordinates) < SCHOOL_TOWN_RADIUS_KM;
}
