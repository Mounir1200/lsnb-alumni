import type { GeneratedArticle, HighlightRepairStore, SourceProfile } from "./types.js";
import { currentWeekStart } from "./week.js";

// Explicit administrative action: the normal cron and public reads never invoke this.
export async function repairWeeklyHighlight(options: {
  store: HighlightRepairStore;
  generate: (profile: SourceProfile) => Promise<GeneratedArticle>;
  now?: Date;
  onFailure?: (slot: number, error: unknown) => void;
}): Promise<{ outcome: "repaired" | "unchanged"; attempted: number; repaired: number; failures: number }> {
  const weekStart = currentWeekStart(options.now);
  let attempted = 0;
  let repaired = 0;
  let failures = 0;
  for (const slot of [1, 2]) {
    // SQL persists this single repair attempt before a potentially billed request.
    // A crash, timeout or later invocation cannot acquire the same slot again.
    const claim = await options.store.claimRepair(weekStart, slot);
    if (claim.outcome !== "claimed") continue;
    if (!claim.repair_token || claim.article?.slot !== slot || claim.article.generation_method !== "fallback") {
      throw new Error("Incomplete Highlight repair reservation.");
    }
    attempted += 1;
    try {
      const result = await options.generate(claim.article.source_profile);
      if (result.generationMethod !== "ai") throw new Error("Highlight repair did not produce an AI article.");
      if (!await options.store.saveRepair(weekStart, slot, claim.repair_token, result)) {
        throw new Error("Unable to save Highlight repair with the current reservation.");
      }
      repaired += 1;
    } catch (error) {
      // The already published article remains visible; no second fallback is stored.
      failures += 1;
      options.onFailure?.(slot, error);
    }
  }
  return { outcome: repaired > 0 ? "repaired" : "unchanged", attempted, repaired, failures };
}
