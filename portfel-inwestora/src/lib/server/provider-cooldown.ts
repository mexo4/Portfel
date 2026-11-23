/**
 * A provider that is not answering should be skipped for a while, not asked
 * again by every lookup that falls through to it.
 *
 * On production Stooq hangs until the client gives up. A history lookup for a
 * symbol Yahoo does not know falls through to Stooq, and each such lookup then
 * waited about 31 s (a 10 s connect failure, then the same request again over a
 * second client with a 20 s timeout). A GPW quote asks Stooq first, through
 * several short calls, and waited ~5.4 s for them before EODHD or Yahoo could
 * answer. After the provider has failed to answer, it is skipped for
 * `cooldownMs`, so those lookups go straight to the next source.
 *
 * Only "no answer at all" (a timeout or a network error) counts. An answer,
 * even "no data for this symbol" or a refusal, means the provider is up and
 * never does. `failuresToOpen` (inside `failureWindowMs`) keeps one slow
 * response from a healthy provider from switching it off.
 */
export const createProviderCooldown = ({
  cooldownMs,
  failuresToOpen = 1,
  failureWindowMs = 60_000,
  now = Date.now,
}: {
  cooldownMs: number;
  failuresToOpen?: number;
  failureWindowMs?: number;
  now?: () => number;
}) => {
  let unavailableUntil = 0;
  let recentFailures: number[] = [];

  return {
    isCoolingDown: () => now() < unavailableUntil,
    markUnavailable: () => {
      const failedAt = now();

      recentFailures = [...recentFailures.filter((time) => failedAt - time <= failureWindowMs), failedAt];

      if (recentFailures.length >= failuresToOpen) {
        unavailableUntil = failedAt + cooldownMs;
      }
    },
    reset: () => {
      unavailableUntil = 0;
      recentFailures = [];
    },
  };
};

export type ProviderCooldown = ReturnType<typeof createProviderCooldown>;

/**
 * Stooq as one host for every caller (history and GPW quotes): if it does not
 * answer one, it will not answer the other. Two failures within a minute open
 * it, which a request burst for several GPW positions produces at once, while
 * a single slow reply does not.
 */
export const stooqCooldown = createProviderCooldown({
  cooldownMs: 10 * 60 * 1_000,
  failuresToOpen: 2,
  failureWindowMs: 60_000,
});
