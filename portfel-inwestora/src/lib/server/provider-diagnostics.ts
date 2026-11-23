/**
 * Server-only diagnostics shared by the market-data providers.
 *
 * Everything here is silent unless `MARKET_DATA_DIAGNOSTICS=true`, like the
 * existing `[market-data:identity]` and `[market-data:crypto-quote]` logs.
 * Nothing logged may contain an API token: callers pass an endpoint label or a
 * URL, and URLs are reduced to host + path before they are printed.
 */

export const isMarketDataDiagnosticsEnabled = () =>
  process.env.MARKET_DATA_DIAGNOSTICS === "true";

/**
 * 402 is EODHD's "daily quota used up"; 429 is per-minute or per-IP throttling
 * (EODHD, Yahoo, CoinGecko, Binance...). Both mean "try the backup", not
 * "this symbol does not exist".
 */
export const isProviderLimitStatus = (status: number | null | undefined) =>
  status === 402 || status === 429;

/** Host + path only, so `?api_token=...` never reaches a log line. */
export const describeEndpoint = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "unknown-endpoint";
  }
};

export const logProviderHttpFailure = (provider: string, status: number, url: string) => {
  if (!isMarketDataDiagnosticsEnabled()) {
    return;
  }

  console.info("[market-data:provider]", {
    provider,
    status,
    limit: isProviderLimitStatus(status),
    endpoint: describeEndpoint(url),
  });
};

export type BackupArea =
  | "etf-quote"
  | "crypto-quote"
  | "crypto-history"
  | "benchmark"
  | "etf-search"
  | "etf-price-source";

export type BackupOutcome = "used" | "no-data" | "rejected" | "skipped";

export const logBackupEvent = (details: {
  area: BackupArea;
  outcome: BackupOutcome;
  symbol?: string;
  yahooSymbol?: string;
  reason?: string;
}) => {
  if (!isMarketDataDiagnosticsEnabled()) {
    return;
  }

  console.info("[market-data:backup]", { backup: "yahoo", ...details });
};
