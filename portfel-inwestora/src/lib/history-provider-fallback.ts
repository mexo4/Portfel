/**
 * Start a lower-priority provider after a short grace period while keeping the
 * existing provider precedence. A valid primary result always wins; the
 * fallback only shortens the empty/slow-primary path and can warm its cache in
 * the background when the primary eventually succeeds.
 */
export const fetchPreferredHistoryWithHedge = async <T>(
  primaryFetcher: () => Promise<T[]>,
  fallbackFetcher: () => Promise<T[]>,
  hedgeDelayMs = 1_200,
  onFallbackStart?: () => void,
): Promise<T[]> => {
  let fallbackStarted = false;
  let startFallback: (() => void) | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  const fallbackPromise = new Promise<T[]>((resolve) => {
    startFallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      onFallbackStart?.();
      void Promise.resolve()
        .then(fallbackFetcher)
        .then(resolve, () => resolve([]));
    };
    fallbackTimer = setTimeout(startFallback, Math.max(0, hedgeDelayMs));
  });

  let primary: T[];
  try {
    primary = await primaryFetcher();
  } catch {
    primary = [];
  }

  if (primary.length > 0) {
    if (!fallbackStarted && fallbackTimer) clearTimeout(fallbackTimer);
    return primary;
  }

  startFallback?.();
  return fallbackPromise;
};
