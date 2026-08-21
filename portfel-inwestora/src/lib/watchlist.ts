import { getGpwTickerCore, isGpwSymbol, normalizeGpwSymbol } from "@/lib/ticker";
import type { AssetSearchResult, CurrencyCode, QuoteProvider } from "@/types/portfolio";

/**
 * A watchlist entry is intentionally market-scoped.  A bare ticker can belong
 * to unrelated issuers on different exchanges, so it is never an identity.
 */
export const getGpwWatchlistCanonicalKey = (symbol: string) => {
  const ticker = getGpwTickerCore(symbol);
  return ticker ? `gpw:ticker:${ticker}` : "";
};

export const isWatchlistEligibleGpwResult = (
  value: Pick<AssetSearchResult, "kind" | "symbol" | "marketCurrency">
) => value.kind === "stock" && value.marketCurrency === "PLN" && isGpwSymbol(value.symbol);

export type WatchlistItem = {
  id: string;
  canonicalKey: string;
  symbol: string;
  name: string;
  marketCurrency: CurrencyCode;
  provider?: QuoteProvider;
  providerId?: string;
  isin?: string;
  coreInstrumentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WatchlistItemInput = Pick<
  AssetSearchResult,
  "symbol" | "name" | "kind" | "marketCurrency" | "provider" | "providerId" | "isin"
>;

export const normalizeWatchlistItemInput = (value: WatchlistItemInput) => {
  if (!isWatchlistEligibleGpwResult(value)) {
    return null;
  }

  const symbol = normalizeGpwSymbol(value.symbol);
  const canonicalKey = getGpwWatchlistCanonicalKey(symbol);
  const name = value.name.trim();

  if (!canonicalKey || !name) {
    return null;
  }

  return {
    canonicalKey,
    symbol,
    name,
    marketCurrency: "PLN" as const,
    provider: value.provider,
    providerId: value.providerId?.trim() || undefined,
    isin: value.isin?.trim().toUpperCase() || undefined,
  };
};
