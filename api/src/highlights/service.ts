import { buildFallbackArticle } from "./generator.js";
import type { GeneratedArticle, HighlightStore, SourceProfile } from "./types.js";
import { currentWeekStart } from "./week.js";

export async function generateWeeklyHighlight(options: {
  store: HighlightStore;
  generate: (profile: SourceProfile) => Promise<GeneratedArticle>;
  now?: Date;
  onFallback?: (slot: number) => void;
}): Promise<{ outcome: "published" | "busy" | "empty"; generated: number; fallbacks: number }> {
  const weekStart = currentWeekStart(options.now);
  const claim = await options.store.claim(weekStart);
  if (claim.outcome !== "claimed") return { outcome: claim.outcome, generated: 0, fallbacks: 0 };
  const { lease_token: leaseToken, articles } = claim;
  if (!leaseToken || articles?.length !== 2) throw new Error("Incomplete Highlight reservation.");

  let generated = 0;
  let fallbacks = 0;
  for (const article of articles) {
    if (article.generated_at) continue;
    let result: GeneratedArticle;
    if (article.ai_attempted_at) {
      // A process may have died after billing but before saving. Never pay for that article again.
      result = buildFallbackArticle(article.source_profile);
    } else {
      const acquired = await options.store.claimAi(weekStart, article.slot, leaseToken);
      if (!acquired) throw new Error("Highlight generation lease is no longer available.");
      try {
        result = await options.generate(article.source_profile);
      } catch {
        result = buildFallbackArticle(article.source_profile);
      }
    }
    if (!await options.store.save(weekStart, article.slot, leaseToken, result)) {
      throw new Error("Unable to save Highlight article with the current lease.");
    }
    generated += 1;
    if (result.generationMethod === "fallback") {
      fallbacks += 1;
      options.onFallback?.(article.slot);
    }
  }
  if (!await options.store.publish(weekStart, leaseToken)) throw new Error("Highlight edition could not be published.");
  return { outcome: "published", generated, fallbacks };
}
