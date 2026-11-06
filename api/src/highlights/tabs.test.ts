import assert from "node:assert/strict";
import test from "node:test";
import { nextTabIndex } from "../../../src/lib/tabs.ts";

test("arrow keys move to the next or previous tab and wrap around", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 1, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
});

test("Home and End reach the first and last tabs; other keys move nothing", () => {
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
  assert.equal(nextTabIndex("Enter", 1, 3), undefined);
});
