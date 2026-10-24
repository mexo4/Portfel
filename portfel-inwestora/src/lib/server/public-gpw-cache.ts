/** Shared by the public month view, public dividend page and iCalendar feed. */
export const PUBLIC_GPW_EVENTS_CACHE_TAG = "public-gpw-events";

/**
 * Called only after the transaction that changed canonical event data commits.
 * Cache invalidation must never make a successfully committed sync look failed.
 */
export const invalidatePublicGpwEventsCache = async () => {
  try {
    // Keep this import lazy: parser/sync unit tests also import the sync module
    // outside Next.js, where `next/cache` is not a runtime dependency.
    const { revalidateTag } = await import("next/cache");
    revalidateTag(PUBLIC_GPW_EVENTS_CACHE_TAG, { expire: 0 });
  } catch (error) {
    console.warn("[public-gpw-cache] invalidation unavailable; bounded TTL remains active", error instanceof Error ? error.name : "unknown");
  }
};
