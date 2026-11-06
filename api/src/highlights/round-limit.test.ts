import assert from "node:assert/strict";
import test from "node:test";
import { createRoundLimit } from "../messaging/roundLimit.js";

test("the round limit refuses rounds past its budget until the minute is over", () => {
  let now = 0;
  const limit = createRoundLimit(2, () => now);
  assert.deepEqual([limit.take(), limit.take()], [{ allowed: true }, { allowed: true }]);
  assert.deepEqual(limit.take(), { allowed: false, retryAfterSeconds: 60 });
  now = 59_001;
  assert.deepEqual(limit.take(), { allowed: false, retryAfterSeconds: 1 });
  now = 60_000;
  assert.deepEqual([limit.take(), limit.take(), limit.take()], [{ allowed: true }, { allowed: true }, { allowed: false, retryAfterSeconds: 60 }]);
});
