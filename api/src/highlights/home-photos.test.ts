import assert from "node:assert/strict";
import test from "node:test";
import { homePhotos, pickHomePhotos, pickPhoto } from "../../../src/data/homePhotos.ts";

const photo = (src: string) => ({ src, alt: `Photo ${src}`, credit: { label: "Crédit" } });

test("one photo of a slot is drawn at random", () => {
  const pool = [photo("a"), photo("b"), photo("c")];
  assert.equal(pickPhoto(pool, () => 0).src, "a");
  assert.equal(pickPhoto(pool, () => 0.5).src, "b");
  assert.equal(pickPhoto(pool, () => 0.999).src, "c");
});

test("every slot of the home page gets a photo from its own pool", () => {
  const picked = pickHomePhotos(() => 0.999);
  for (const slot of Object.keys(homePhotos) as (keyof typeof homePhotos)[]) {
    assert.ok(homePhotos[slot].includes(picked[slot]), slot);
  }
});

test("every home photo describes itself and credits its source", () => {
  for (const [slot, pool] of Object.entries(homePhotos)) {
    assert.ok(pool.length > 0, slot);
    for (const item of pool) {
      assert.ok(item.alt.trim().length > 10, item.src);
      assert.ok(item.credit.label.trim(), item.src);
    }
  }
});
