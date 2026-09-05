import "dotenv/config";
import { loadConfig } from "../config.js";
import { createMistralGenerator, generationFailureDetails } from "./generator.js";
import { repairWeeklyHighlight } from "./repair.js";
import { generateWeeklyHighlight } from "./service.js";
import { createHighlightStore } from "./store.js";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--repair-fallbacks") || args.length > 1) {
    throw new Error("Usage: highlights:generate [--repair-fallbacks]");
  }
  const config = loadConfig();
  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  const model = process.env.MISTRAL_MODEL?.trim() || "mistral-small-latest";
  // Configuration errors must not reserve a week or consume the single AI attempt.
  if (!config.highlightStorage || !apiKey) {
    throw new Error("Set SUPABASE_URL, SUPABASE_SECRET_KEY and MISTRAL_API_KEY before running Highlights.");
  }
  const store = createHighlightStore(config.highlightStorage);
  const generate = createMistralGenerator({ apiKey, model });
  const result = args.includes("--repair-fallbacks")
    ? await repairWeeklyHighlight({ store, generate,
      onFailure: (slot, error) => console.warn(JSON.stringify({ event: "highlight_repair_failed", slot,
        ...generationFailureDetails(error) })),
    })
    : await generateWeeklyHighlight({ store, generate,
      onFallback: (slot, failure) => console.warn(JSON.stringify({ event: "highlight_fallback_saved", slot, ...failure })),
    });
  console.info(JSON.stringify(result));
  if ("failures" in result && result.failures > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Highlight job failed.");
  process.exitCode = 1;
}
