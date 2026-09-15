import type { HighlightArticle } from "./highlightRepository";

const MIN_PREVIEW_CHARACTERS = 240;
const MAX_PREVIEW_CHARACTERS = 650;

/** Balance the two excerpts without rewriting or padding either saved portrait. */
export function buildHighlightPreviews(articles: readonly Pick<HighlightArticle, "paragraphs">[]) {
  const texts = articles.map((article) => article.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean).join(" "));
  const lengths = texts.map((text) => text.length).filter((length) => length > 0);
  const limit = Math.min(MAX_PREVIEW_CHARACTERS, Math.max(MIN_PREVIEW_CHARACTERS, Math.min(...lengths)));

  return texts.map((text) => {
    if (text.length <= limit) return { text, hasMore: false };

    // Prefer a whole sentence near the target, otherwise end at a whole word.
    const prefix = text.slice(0, limit);
    const sentenceEnds = [...prefix.matchAll(/[.!?…](?:[»”"])?(?=\s|$)/gu)];
    const lastSentence = sentenceEnds.at(-1);
    const sentenceEnd = lastSentence ? lastSentence.index + lastSentence[0].length : 0;
    const wordEnd = prefix.lastIndexOf(" ");
    const endsWithSentence = sentenceEnd >= limit * 0.75;
    const end = endsWithSentence ? sentenceEnd : wordEnd;
    // Bound even unbroken text, without splitting a Unicode code point.
    const excerpt = (end > 0 ? text.slice(0, end) : prefix.replace(/[\uD800-\uDBFF]$/u, "")).trimEnd();
    return { text: endsWithSentence ? excerpt : `${excerpt}…`, hasMore: true };
  });
}
