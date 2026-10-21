const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

type PageResult = { data: unknown[] | null; error: unknown };
type IdentifiedRow = { id: string; created_at: string };

// Page by immutable ID to avoid duplicates when rows are added/removed. Continue
// until an empty page even if the API's configured cap is below our page size.
// This is a live view, refreshed after actions, rather than a database snapshot.
export async function collectRowsById(loadPage: (before?: string) => PromiseLike<PageResult>) {
  const rows = new Map<string, IdentifiedRow>();
  let before: string | undefined;
  for (;;) {
    const { data, error } = await loadPage(before);
    if (error) throw error;
    const page = (data ?? []) as IdentifiedRow[];
    if (!page.length) return [...rows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    for (const row of page) rows.set(row.id, row);
    const next = page[page.length - 1]!.id;
    // IDs are interpolated into PostgREST filters; never reuse filter syntax.
    if ((before && next >= before) || !isUuid(next)) throw new Error("Invalid pagination cursor");
    before = next;
  }
}
