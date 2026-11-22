/** How long a public read keeps a successful answer: a flood costs Supabase one read per period. */
export const PUBLIC_READ_TTL_MS = 10_000;

/**
 * Remembers the last successful answer for one key during `ttlMs`; callers in
 * the meantime share it, even while it is still on its way. A failure is
 * never kept: the next caller asks again.
 */
export function keepFor<K, T>(load: (key: K) => Promise<T>, ttlMs: number, now: () => number): (key: K) => Promise<T> {
  let entry: { key: K; value: Promise<T>; until: number } | undefined;
  return (key) => {
    const time = now();
    if (entry && entry.key === key && time < entry.until) return entry.value;
    const current = { key, value: load(key), until: time + ttlMs };
    entry = current;
    current.value.catch(() => { if (entry === current) entry = undefined; });
    return current.value;
  };
}
