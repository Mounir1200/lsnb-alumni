import assert from "node:assert/strict";
import test from "node:test";
import { DIRECTORY_PORTRAIT_SLOTS, pickDirectoryPortraits } from "../../../src/lib/directoryPortraits.ts";

const member = (id: string, photoUrl?: string) => ({ id, photoUrl });
const shown = (slots: ReturnType<typeof pickDirectoryPortraits<{ id: string; photoUrl?: string }>>) =>
  slots.map((slot) => (slot.kind === "portrait" ? slot.profile.id : "placeholder"));

test("only members with a photo are shown, and the empty places wait for the next photos", () => {
  const members = [member("a", "a.jpg"), member("b"), member("c", "c.jpg"), member("d", "d.jpg"), member("e", "")];
  const slots = pickDirectoryPortraits(members, () => 0.999);
  assert.equal(slots.length, DIRECTORY_PORTRAIT_SLOTS);
  assert.deepEqual(shown(slots), ["a", "c", "d", "placeholder"]);
});

test("a fourth photo takes the last place, and more photos are drawn at random", () => {
  const members = ["a", "b", "c", "d", "e", "f"].map((id) => member(id, `${id}.jpg`));
  assert.deepEqual(shown(pickDirectoryPortraits(members.slice(0, 4), () => 0.999)), ["a", "b", "c", "d"]);
  assert.deepEqual(shown(pickDirectoryPortraits(members, () => 0.999)), ["a", "b", "c", "d"]);
  assert.deepEqual(shown(pickDirectoryPortraits(members, () => 0)), ["b", "c", "d", "e"]);
});

test("without any photo, every place waits", () => {
  assert.deepEqual(shown(pickDirectoryPortraits([member("a")], Math.random)), ["placeholder", "placeholder", "placeholder", "placeholder"]);
});
