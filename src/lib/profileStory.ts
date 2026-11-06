export type StoryBlocks = { paragraphs: string[] };

/**
 * Splits a member's free-text story into paragraphs. Every paragraph is shown
 * at the same size: the words themselves are never changed or reordered.
 */
export function toStoryBlocks(story: string): StoryBlocks {
  return { paragraphs: story.split("\n").map((paragraph) => paragraph.trim()).filter(Boolean) };
}
