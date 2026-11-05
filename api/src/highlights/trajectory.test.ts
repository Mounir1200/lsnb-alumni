import assert from "node:assert/strict";
import test from "node:test";
import type { CareerStep } from "../../../src/lib/careerSteps.ts";
import { MAX_TRAJECTORY_STOPS, toTrajectoryStops } from "../../../src/lib/trajectory.ts";

const step = (location: string, startYear: number): CareerStep =>
  ({ kind: "education", title: "Étape", organization: "", location, startYear, endYear: startYear + 1 });
const names = (stops: { name: string }[]) => stops.map((stop) => stop.name);

test("the path goes through each step's place, then where the member lives today", () => {
  const steps = [step("Ouagadougou, Burkina Faso", 2019), step("Paris, France", 2021), step("Montréal, Canada", 2023)];
  const stops = toTrajectoryStops(steps, "Montréal", "Canada");
  assert.deepEqual(names(stops), ["Ouagadougou", "Paris", "Montréal"]);
  assert.deepEqual(stops[1]?.coordinates, { latitude: 48.86, longitude: 2.35 });
});

test("the school town, unknown places and repeats are skipped, a return home is kept", () => {
  const steps = [step("Bobo-Dioulasso, Burkina Faso", 2014), step("Atlantis", 2017), step("Lyon, France", 2018), step("Lyon", 2020)];
  assert.deepEqual(names(toTrajectoryStops(steps, "Bobo-Dioulasso", "Burkina Faso")), ["Lyon", "Bobo-Dioulasso"]);
});

test("a country alone is enough to place a step", () => {
  assert.deepEqual(names(toTrajectoryStops([step("Sénégal", 2020)], "Ville non renseignée", "Pays non renseigné")), ["Sénégal"]);
});

test("a long path keeps its most recent places", () => {
  const cities = ["Dakar", "Abidjan", "Bamako", "Niamey", "Lomé", "Cotonou", "Paris", "Lyon"];
  const stops = toTrajectoryStops(cities.map((city, index) => step(city, 2010 + index)), "Montréal", "Canada");
  assert.equal(stops.length, MAX_TRAJECTORY_STOPS);
  assert.deepEqual(names(stops).slice(-2), ["Lyon", "Montréal"]);
});

test("a member without any known place has no stop to draw", () => {
  assert.deepEqual(toTrajectoryStops([step("", 2020)], "Ville non renseignée", "Pays non renseigné"), []);
});

test("an unknown city still places a step in its known country", () => {
  assert.deepEqual(names(toTrajectoryStops([step("Villeinconnue, Maroc", 2020)], "", "")), ["Maroc"]);
});

test("a detailed place keeps its city, whatever sits between city and country", () => {
  assert.deepEqual(names(toTrajectoryStops([step("Paris, Île-de-France, France", 2020)], "", "")), ["Paris"]);
});

test("two different places in a row are both kept", () => {
  assert.deepEqual(names(toTrajectoryStops([step("Lyon, France", 2019), step("Paris, France", 2021)], "", "")), ["Lyon", "Paris"]);
});
