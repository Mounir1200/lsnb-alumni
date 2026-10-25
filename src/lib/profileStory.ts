/** Opening sentences longer than this read better as body text than as a lede. */
const LEDE_MAX_CHARACTERS = 200;
/** Shorter fragments are likely abbreviations ("M.", "Dr.") rather than sentences. */
const LEDE_MIN_CHARACTERS = 40;
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?=[\p{Lu}«“"(])/u;

export type StoryBlocks = { lede?: string; paragraphs: string[] };

function characterCount(value: string) {
  return [...value].length;
}

/**
 * Splits a member's free-text story into paragraphs, keeping the first short
 * sentence (or short first paragraph) apart so it can open the story as a lede.
 * The words themselves are never changed.
 */
export function toStoryBlocks(story: string): StoryBlocks {
  const paragraphs = story.split("\n").map((paragraph) => paragraph.trim()).filter(Boolean);
  const [first, ...rest] = paragraphs;
  if (!first) return { paragraphs: [] };
  if (characterCount(first) <= LEDE_MAX_CHARACTERS) return { lede: first, paragraphs: rest };

  const [sentence = "", ...remainder] = first.split(SENTENCE_BOUNDARY);
  const sentenceLength = characterCount(sentence);
  if (remainder.length && sentenceLength >= LEDE_MIN_CHARACTERS && sentenceLength <= LEDE_MAX_CHARACTERS) {
    return { lede: sentence, paragraphs: [remainder.join(" "), ...rest] };
  }
  return { paragraphs };
}
