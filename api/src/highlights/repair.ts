import { HighlightGenerationError } from "./generator.js";
import type { GeneratedArticle, HighlightRepairFailure, HighlightRepairStore, SourceProfile } from "./types.js";
import { currentWeekStart } from "./week.js";

// Explicit administrative action: the normal cron and public reads never invoke this.
export async function repairWeeklyHighlight(options: {
  store: HighlightRepairStore;
  generate: (profile: SourceProfile) => Promise<GeneratedArticle>;
  now?: Date;
  retryFailed?: boolean;
  onFailure?: (slot: number, error: unknown) => void;
  onSkip?: (slot: number, outcome: "attempted" | "cooldown" | "unavailable") => void;
}): Promise<{ outcome: "repaired" | "unchanged"; attempted: number; repaired: number; failures: number }> {
  const weekStart = currentWeekStart(options.now);
  let attempted = 0;
  let repaired = 0;
  let failures = 0;
  for (const slot of [1, 2]) {
    // Every attempt is persisted before the potentially billed request. A retry
    // requires an explicit admin flag, cooldown and remaining SQL attempt budget.
    const claim = await options.store.claimRepair(weekStart, slot, options.retryFailed ?? false);
    if (claim.outcome !== "claimed") {
      if (!["attempted", "cooldown", "unavailable"].includes(claim.outcome)) throw new Error("Invalid Highlight repair reservation.");
      options.onSkip?.(slot, claim.outcome);
      continue;
    }
    if (!claim.repair_token || claim.article?.slot !== slot || claim.article.generation_method !== "fallback") {
      throw new Error("Incomplete Highlight repair reservation.");
    }
    attempted += 1;
    let generatedArticle = false;
    try {
      const result = await options.generate(claim.article.source_profile);
      if (result.generationMethod !== "ai") throw new Error("Highlight repair did not produce an AI article.");
      generatedArticle = true;
      if (!await options.store.saveRepair(weekStart, slot, claim.repair_token, result)) {
        throw new Error("Unable to save Highlight repair with the current reservation.");
      }
      repaired += 1;
    } catch (error) {
      // The already published article remains visible; no second fallback is stored.
      failures += 1;
      options.onFailure?.(slot, error);
      // A lost save is ambiguous: do not mark it as a provider failure or
      // immediately reacquire it. Its lease must expire before an admin retry.
      if (!generatedArticle) {
        const failure: HighlightRepairFailure = error instanceof HighlightGenerationError
          ? { code: error.status === 429 ? "rate_limited" : error.code,
            httpStatus: error.status ?? null, retryAfterSeconds: error.retryAfterSeconds ?? null }
          : { code: "unexpected_error", httpStatus: null, retryAfterSeconds: null };
        if (!await options.store.recordRepairFailure(weekStart, slot, claim.repair_token, failure)) {
          throw new Error("Unable to record Highlight repair failure; keep the existing attempt reservation.");
        }
        // Organization-wide rate limits can also affect the other profile.
        // Leave that slot untouched for a later explicitly requested run.
        if (failure.code === "rate_limited") break;
      }
    }
  }
  return { outcome: repaired > 0 ? "repaired" : "unchanged", attempted, repaired, failures };
}
