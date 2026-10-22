import { geoContains, geoEquirectangular, geoGraticule10, geoPath } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import * as THREE from "three";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { Coordinates } from "../../data/places";

// 2:1 equirectangular map, wrapped onto the sphere by its default UVs.
const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = TEXTURE_WIDTH / 2;

const mapColors = {
  ocean: "#0b2744",
  graticule: "rgba(154, 186, 214, 0.16)",
  land: "#2a5a82",
  border: "rgba(10, 34, 58, 0.85)",
  origin: "#d99452",
  destination: "#5f9a6c",
};

type CountryFeature = Feature<Geometry, { name: string }>;
type WorldAtlas = Topology<{ countries: GeometryCollection<{ name: string }> }>;

async function loadCountries(): Promise<CountryFeature[]> {
  // Natural Earth 1:110m countries, split into its own chunk and loaded with the globe.
  const atlas = (await import("world-atlas/countries-110m.json")).default as unknown as WorldAtlas;
  return feature(atlas, atlas.objects.countries).features as CountryFeature[];
}

function toLongitudeLatitude({ latitude, longitude }: Coordinates): [number, number] {
  return [longitude, latitude];
}

/** Countries drawn as a map texture, the school's country and the destination's highlighted. */
export async function createWorldTexture(origin: Coordinates, destination?: Coordinates) {
  const countries = await loadCountries();
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");

  const projection = geoEquirectangular()
    .scale(TEXTURE_WIDTH / (2 * Math.PI))
    .translate([TEXTURE_WIDTH / 2, TEXTURE_HEIGHT / 2]);
  const path = geoPath(projection, context);

  context.fillStyle = mapColors.ocean;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  context.beginPath();
  path(geoGraticule10());
  context.strokeStyle = mapColors.graticule;
  context.lineWidth = 1.2;
  context.stroke();

  const originPoint = toLongitudeLatitude(origin);
  const destinationPoint = destination ? toLongitudeLatitude(destination) : undefined;
  for (const country of countries) {
    const isDestination = destinationPoint !== undefined && geoContains(country, destinationPoint);
    const isOrigin = geoContains(country, originPoint);
    context.beginPath();
    path(country);
    context.fillStyle = isDestination ? mapColors.destination : isOrigin ? mapColors.origin : mapColors.land;
    context.fill();
    context.strokeStyle = mapColors.border;
    context.lineWidth = 1.4;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
