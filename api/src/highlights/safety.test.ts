import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REPORT_REASONS, REPORTED_MESSAGE_COUNT, reportProblem } from "../../../src/lib/safety.ts";

const projectFile = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("the report form offers exactly the reasons the database accepts", async () => {
  const migration = await projectFile("supabase/migrations/20261109170000_member_reports.sql");
  const accepted = migration.match(/reason in \(([^)]*)\)/)?.[1]?.match(/'([a-z_]+)'/g)?.map((value) => value.slice(1, -1));
  assert.deepEqual(REPORT_REASONS.map((reason) => reason.value).sort(), [...(accepted ?? [])].sort());
});

test("the charter, the privacy policy and the database hand moderators the same number of messages", async () => {
  const migration = await projectFile("supabase/migrations/20261109170000_member_reports.sql");
  assert.match(migration, new RegExp(`order by latest\\.sequence desc limit ${REPORTED_MESSAGE_COUNT}\\b`));
  for (const page of ["src/pages/CharterPage.tsx", "src/pages/PrivacyPage.tsx"]) {
    assert.match(await projectFile(page), /\{REPORTED_MESSAGE_COUNT\}/, page);
  }
});

test("a report needs a reason, and a description for anything else", () => {
  assert.match(reportProblem("", "") ?? "", /Choisissez un motif/);
  assert.equal(reportProblem("harassment", ""), null);
  assert.match(reportProblem("other", "   court   ") ?? "", /10 caractères/);
  assert.match(reportProblem("other", "123456789") ?? "", /10 caractères/);
  assert.equal(reportProblem("other", " 1234567890 "), null);
  assert.equal(reportProblem("other", "Il se fait passer pour un professeur."), null);
  assert.equal(reportProblem("scam", "x".repeat(1000)), null);
  assert.match(reportProblem("scam", "x".repeat(1001)) ?? "", /1 000 caractères/);
});
