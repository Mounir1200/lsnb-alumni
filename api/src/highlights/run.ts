import "dotenv/config";
import { loadConfig } from "../config.js";
import { createMistralGenerator } from "./generator.js";
import { generateWeeklyHighlight } from "./service.js";
import { createHighlightStore } from "./store.js";

try {
  const config = loadConfig();
  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  const model = process.env.MISTRAL_MODEL?.trim() || "mistral-small-latest";
  // Configuration errors must not reserve a week or consume the single AI attempt.
  if (!config.highlightStorage || !apiKey) {
    throw new Error("Set SUPABASE_URL, SUPABASE_SECRET_KEY and MISTRAL_API_KEY before running Highlights.");
  }
  const result = await generateWeeklyHighlight({
    store: createHighlightStore(config.highlightStorage),
    generate: createMistralGenerator({ apiKey, model }),
    onFallback: (slot) => console.warn(`Highlight slot ${slot}: saved a factual fallback; no additional AI request.`),
  });
  console.info(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Highlight job failed.");
  process.exitCode = 1;
}
