/**
 * A small in-process memory with a time to live per entry.
 *
 * Meant for outcomes that are expensive to re-derive on every request but may be
 * reused for a short while: the answer of a provider that keeps failing, or a
 * lookup that already went through the shared database cache. It is not a data
 * store: entries vanish with the process, the size is bounded, and a stale entry
 * is simply a miss. `clear()` lets a caller invalidate everything at once.
 */
export type TtlMemo<T> = {
  /** `undefined` is a miss; a stored `undefined` is not supported, store `null` instead. */
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  delete: (key: string) => void;
  clear: () => void;
  readonly size: number;
};

export const createTtlMemo = <T>({
  ttlMs,
  maxEntries = 1_000,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}): TtlMemo<T> => {
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      // Re-inserting moves the key to the end, so the oldest key is always first.
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
};
