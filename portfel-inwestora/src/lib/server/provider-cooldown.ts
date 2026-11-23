/**
 * A provider that is not answering should be skipped for a while, not asked
 * again by every lookup that falls through to it.
 *
 * On production Stooq hangs until the client gives up. A history lookup for a
 * symbol Yahoo does not know falls through to Stooq, and each such lookup then
 * waited about 31 s (a 10 s connect failure, then the same request again over a
 * second client with a 20 s timeout). Adding a benchmark or a position whose
 * first candidate symbol misses cost that every time its short-lived empty
 * result expired. After one unreachable answer the provider is skipped for
 * `cooldownMs`, so the next lookups fail in milliseconds instead.
 *
 * Only "unreachable" (a timeout or a network error) opens it. An answer, even
 * "no data for this symbol", means the provider is up and never does.
 */
export const createProviderCooldown = ({
  cooldownMs,
  now = Date.now,
}: {
  cooldownMs: number;
  now?: () => number;
}) => {
  let unavailableUntil = 0;

  return {
    isCoolingDown: () => now() < unavailableUntil,
    markUnavailable: () => {
      unavailableUntil = now() + cooldownMs;
    },
    reset: () => {
      unavailableUntil = 0;
    },
  };
};

export type ProviderCooldown = ReturnType<typeof createProviderCooldown>;
