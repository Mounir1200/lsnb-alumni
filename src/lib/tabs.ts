/**
 * Keyboard moves between tabs, as the ARIA tabs pattern describes: arrows go
 * to the next or previous tab and wrap around, Home and End reach the ends.
 * Any other key moves nothing.
 */
export function nextTabIndex(key: string, index: number, count: number): number | undefined {
  const last = count - 1;
  if (key === "ArrowRight") return index === last ? 0 : index + 1;
  if (key === "ArrowLeft") return index === 0 ? last : index - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  return undefined;
}
