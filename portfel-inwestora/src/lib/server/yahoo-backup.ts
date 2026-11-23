import { logBackupEvent, type BackupArea } from "@/lib/server/provider-diagnostics";
import {
  fetchYahooDailyHistory,
  fetchYahooQuote,
  searchYahooEtfs,
  YAHOO_UNKNOWN_CURRENCY,
  type YahooEtfSearchItem,
} from "@/lib/server/yahoo";
import { inferCurrencyFromSymbol, normalizeSymbol } from "@/lib/ticker";
import { toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  AssetQuote,
  CurrencyCode,
  EtfListing,
  InstrumentIdentity,
  QuoteProvider,
} from "@/types/portfolio";

/**
 * Yahoo Finance as the last-resort source, used when an instrument's own
 * provider has no data for it or has hit its API limit.
 *
 * Two rules keep a backup from doing damage:
 * - A Yahoo symbol is only ever derived from an identity we already trust (an
 *   EODHD provider id, an OpenFIGI venue code), never from a bare ticker, and
 *   the answer is accepted only when the currency matches what was requested.
 * - A backup *quote* carries the price only. See `AssetQuote.backupSource`.
 */

export type YahooQuoteFetcher = typeof fetchYahooQuote;
export type YahooHistoryFetcher = typeof fetchYahooDailyHistory;
export type YahooEtfSearcher = typeof searchYahooEtfs;

const MAX_YAHOO_ETF_SEARCH_LISTINGS = 8;
const YAHOO_LISTING_ID_PREFIX = "ETF:YAHOO:";
const YAHOO_SYMBOL_PATTERN = /^[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,4})?(?:\.[A-Z]{1,4})?$/;
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const CRYPTO_CODE_PATTERN = /^[A-Z0-9]{2,15}$/;

export const isPlausibleYahooSymbol = (symbol: string) =>
  symbol.length <= 20 && YAHOO_SYMBOL_PATTERN.test(symbol);

/**
 * A listing that was discovered through Yahoo search has neither a FIGI nor an
 * ISIN, and its currency is only a placeholder. Its `listingId` says so; the
 * id is normalised to upper case when it round-trips through the browser.
 */
export const isYahooSearchListing = (
  listing: Pick<EtfListing, "listingId" | "provider" | "providerId">
) =>
  listing.provider === "yahoo" &&
  Boolean(listing.providerId) &&
  normalizeSymbol(listing.listingId).startsWith(YAHOO_LISTING_ID_PREFIX);

/** EODHD exchange code (or an already-Yahoo spelling) -> Yahoo ticker suffix. */
const YAHOO_SUFFIX_BY_EODHD_EXCHANGE: Readonly<Record<string, string>> = {
  US: "",
  LSE: ".L",
  L: ".L",
  XETRA: ".DE",
  DE: ".DE",
  F: ".F",
  PA: ".PA",
  AS: ".AS",
  MI: ".MI",
  SW: ".SW",
  TO: ".TO",
  HK: ".HK",
  WAR: ".WA",
  PL: ".WA",
  WA: ".WA",
};

/** Bloomberg (OpenFIGI) exchange code -> Yahoo ticker suffix. */
const YAHOO_SUFFIX_BY_OPENFIGI_EXCHANGE: Readonly<Record<string, string>> = {
  US: "",
  GR: ".DE",
  GY: ".F",
  LN: ".L",
  FP: ".PA",
  NA: ".AS",
  IM: ".MI",
  SW: ".SW",
  CN: ".TO",
  CT: ".TO",
  HK: ".HK",
};

/**
 * `CSPX.LSE` -> `CSPX.L`, `SPY.US` -> `SPY`, `ETFBW20TR.PL` -> `ETFBW20TR.WA`.
 * An id without a known exchange suffix has no safe Yahoo spelling: `null`.
 */
export const toYahooSymbolFromEodhdProviderId = (providerId: string): string | null => {
  const normalized = normalizeSymbol(providerId);
  const separatorIndex = normalized.lastIndexOf(".");

  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    return null;
  }

  const exchange = normalized.slice(separatorIndex + 1);

  if (!Object.hasOwn(YAHOO_SUFFIX_BY_EODHD_EXCHANGE, exchange)) {
    return null;
  }

  const yahooSymbol = `${normalized.slice(0, separatorIndex)}${YAHOO_SUFFIX_BY_EODHD_EXCHANGE[exchange]}`;
  return isPlausibleYahooSymbol(yahooSymbol) ? yahooSymbol : null;
};

/**
 * Only for a listing that came from OpenFIGI (it has a FIGI), because only then
 * is `exchangeCode` a Bloomberg code rather than another provider's venue name.
 */
export const toYahooSymbolFromOpenFigiListing = (
  listing: Pick<EtfListing, "symbol" | "exchangeCode" | "instrumentIdentity">
): string | null => {
  if (!listing.instrumentIdentity.figi) {
    return null;
  }

  const exchangeCode = normalizeSymbol(
    listing.instrumentIdentity.exchangeCode ?? listing.exchangeCode ?? ""
  );
  const ticker = normalizeSymbol(listing.instrumentIdentity.ticker || listing.symbol);

  if (!ticker || ticker.includes(".") || !Object.hasOwn(YAHOO_SUFFIX_BY_OPENFIGI_EXCHANGE, exchangeCode)) {
    return null;
  }

  const yahooSymbol = `${ticker}${YAHOO_SUFFIX_BY_OPENFIGI_EXCHANGE[exchangeCode]}`;
  return isPlausibleYahooSymbol(yahooSymbol) ? yahooSymbol : null;
};

/** `LINK` -> `LINK-USD`. Yahoo quotes crypto against USD, like Binance and CoinGecko here. */
export const toYahooCryptoSymbol = (symbol: string): string | null => {
  const normalized = normalizeSymbol(symbol);
  return CRYPTO_CODE_PATTERN.test(normalized) ? `${normalized}-USD` : null;
};

/**
 * Crypto tickers collide: Yahoo's `ARB-USD` is "ARbit", not Arbitrum, and the
 * pair says nothing but a ticker. So a Yahoo coin is accepted only when its own
 * name matches what we expect: the known name of a major coin below, or else
 * the CoinGecko id the asset was saved with ("chainlink" for "Chainlink USD").
 * Anything else is refused, which means "no backup price", never a wrong one.
 */
const YAHOO_CRYPTO_NAME_BY_SYMBOL: Readonly<Record<string, string>> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "bnb",
  SOL: "solana",
  XRP: "xrp",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  TRX: "tron",
  AVAX: "avalanche",
  LINK: "chainlink",
  LTC: "litecoin",
};

const normalizeCoinName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export const isConfirmedYahooCrypto = ({
  symbol,
  providerId,
  yahooName,
}: {
  symbol: string;
  providerId?: string;
  yahooName?: string;
}) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const expectedName = Object.hasOwn(YAHOO_CRYPTO_NAME_BY_SYMBOL, normalizedSymbol)
    ? YAHOO_CRYPTO_NAME_BY_SYMBOL[normalizedSymbol]
    : normalizeCoinName(providerId ?? "");
  // Yahoo names a pair "<coin> USD"; the coin is what is left without the currency.
  const actualName = normalizeCoinName((yahooName ?? "").replace(/\s+USD$/i, ""));

  return Boolean(expectedName) && expectedName === actualName;
};

type RequestedMapping = {
  symbol: string;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
};

/** Price and timestamps from Yahoo, identity from the request. */
const buildBackupQuote = (yahooQuote: AssetQuote, requested: RequestedMapping): AssetQuote => ({
  symbol: normalizeSymbol(requested.symbol),
  price: yahooQuote.price,
  marketCurrency: requested.marketCurrency,
  provider: requested.provider,
  providerId: requested.providerId,
  priceScale: requested.priceScale,
  fetchedAt: yahooQuote.fetchedAt,
  marketTimestamp: yahooQuote.marketTimestamp,
  priceDate: yahooQuote.priceDate,
  previousClose: yahooQuote.previousClose,
  backupSource: "yahoo",
});

type VerifiedYahooQuote = { quote: AssetQuote } | { quote: null; reason: string };

/**
 * Asks Yahoo for exactly one symbol. Passing it as both `symbol` and
 * `providerId` stops `fetchYahooQuote` from also trying a bare ticker, and the
 * "unknown currency" fallback makes an answer without a currency fail.
 */
const fetchVerifiedYahooQuote = async (
  yahooSymbol: string,
  fetchQuote: YahooQuoteFetcher
): Promise<VerifiedYahooQuote> => {
  const quote = await fetchQuote({
    symbol: yahooSymbol,
    providerId: yahooSymbol,
    fallbackCurrency: YAHOO_UNKNOWN_CURRENCY,
  });

  if (!quote) {
    return { quote: null, reason: "no-quote-or-currency" };
  }

  if (normalizeSymbol(quote.providerId ?? "") !== yahooSymbol) {
    return { quote: null, reason: "symbol-mismatch" };
  }

  return { quote };
};

export const fetchYahooBackupEtfQuote = async ({
  requestedSymbol,
  providerIds,
  fetchQuote = fetchYahooQuote,
  ...requested
}: {
  requestedSymbol: string;
  /** Provider ids we already trust for this instrument; never lookup tickers. */
  providerIds: Array<string | undefined>;
  fetchQuote?: YahooQuoteFetcher;
} & Omit<RequestedMapping, "symbol">): Promise<AssetQuote | null> => {
  const yahooSymbols = uniqueBy(
    providerIds.flatMap((providerId) => {
      const yahooSymbol = providerId ? toYahooSymbolFromEodhdProviderId(providerId) : null;
      return yahooSymbol ? [yahooSymbol] : [];
    }),
    (yahooSymbol) => yahooSymbol
  );

  if (yahooSymbols.length === 0) {
    logBackupEvent({
      area: "etf-quote",
      outcome: "skipped",
      symbol: requestedSymbol,
      reason: "unsupported-venue",
    });
    return null;
  }

  for (const yahooSymbol of yahooSymbols) {
    const verified = await fetchVerifiedYahooQuote(yahooSymbol, fetchQuote);

    if (!verified.quote) {
      logBackupEvent({
        area: "etf-quote",
        outcome: "no-data",
        symbol: requestedSymbol,
        yahooSymbol,
        reason: verified.reason,
      });
      continue;
    }

    if (toCurrencyCode(verified.quote.marketCurrency) !== toCurrencyCode(requested.marketCurrency)) {
      logBackupEvent({
        area: "etf-quote",
        outcome: "rejected",
        symbol: requestedSymbol,
        yahooSymbol,
        reason: "currency-mismatch",
      });
      continue;
    }

    logBackupEvent({ area: "etf-quote", outcome: "used", symbol: requestedSymbol, yahooSymbol });
    return buildBackupQuote(verified.quote, { ...requested, symbol: requestedSymbol });
  }

  return null;
};

export const fetchYahooBackupCryptoQuote = async ({
  requestedSymbol,
  isFresh,
  fetchQuote = fetchYahooQuote,
  ...requested
}: {
  requestedSymbol: string;
  /** Freshness policy stays with the caller, which owns the crypto age limits. */
  isFresh: (quote: AssetQuote) => boolean;
  fetchQuote?: YahooQuoteFetcher;
} & Omit<RequestedMapping, "symbol">): Promise<AssetQuote | null> => {
  const yahooSymbol = toYahooCryptoSymbol(requestedSymbol);

  if (!yahooSymbol || toCurrencyCode(requested.marketCurrency) !== "USD") {
    logBackupEvent({
      area: "crypto-quote",
      outcome: "skipped",
      symbol: requestedSymbol,
      reason: yahooSymbol ? "non-usd-asset" : "unsupported-symbol",
    });
    return null;
  }

  const verified = await fetchVerifiedYahooQuote(yahooSymbol, fetchQuote);

  if (!verified.quote) {
    logBackupEvent({
      area: "crypto-quote",
      outcome: "no-data",
      symbol: requestedSymbol,
      yahooSymbol,
      reason: verified.reason,
    });
    return null;
  }

  const rejection =
    verified.quote.instrumentType !== "CRYPTO"
      ? "not-crypto"
      : verified.quote.marketCurrency !== "USD"
        ? "currency-mismatch"
        : !isConfirmedYahooCrypto({
              symbol: requestedSymbol,
              providerId: requested.providerId,
              yahooName: verified.quote.name,
            })
          ? "coin-identity-unconfirmed"
          : !isFresh(verified.quote)
            ? "stale"
            : null;

  if (rejection) {
    logBackupEvent({
      area: "crypto-quote",
      outcome: "rejected",
      symbol: requestedSymbol,
      yahooSymbol,
      reason: rejection,
    });
    return null;
  }

  logBackupEvent({ area: "crypto-quote", outcome: "used", symbol: requestedSymbol, yahooSymbol });
  return buildBackupQuote(verified.quote, { ...requested, symbol: requestedSymbol });
};

/** Daily USD closes of a coin, only when Yahoo confirms the pair is this very coin. */
export const fetchYahooCryptoHistoryPoints = async ({
  symbol,
  providerId,
  startDate,
  endDate,
  fetchHistory = fetchYahooDailyHistory,
}: {
  symbol: string;
  /** The CoinGecko id the asset was saved with, used to confirm the coin. */
  providerId?: string;
  startDate: string;
  endDate: string;
  fetchHistory?: YahooHistoryFetcher;
}): Promise<Array<{ date: string; close: number }>> => {
  const yahooSymbol = toYahooCryptoSymbol(symbol);

  if (!yahooSymbol) {
    logBackupEvent({
      area: "crypto-history",
      outcome: "skipped",
      symbol,
      reason: "unsupported-symbol",
    });
    return [];
  }

  const history = await fetchHistory({ symbol: yahooSymbol, startDate, endDate });

  if (!history || history.points.length === 0) {
    logBackupEvent({ area: "crypto-history", outcome: "no-data", symbol, yahooSymbol });
    return [];
  }

  if (
    history.instrumentType?.trim().toUpperCase() !== "CRYPTOCURRENCY" ||
    history.currency?.trim().toUpperCase() !== "USD" ||
    !isConfirmedYahooCrypto({ symbol, providerId, yahooName: history.name })
  ) {
    logBackupEvent({
      area: "crypto-history",
      outcome: "rejected",
      symbol,
      yahooSymbol,
      reason: "not-this-coin-in-usd",
    });
    return [];
  }

  logBackupEvent({ area: "crypto-history", outcome: "used", symbol, yahooSymbol });
  return history.points;
};

/** Benchmark series: closes only, no identity checks (the symbol list is fixed in code). */
export const fetchYahooBenchmarkPoints = async ({
  yahooSymbol,
  startDate,
  endDate,
  fetchHistory = fetchYahooDailyHistory,
}: {
  yahooSymbol: string;
  startDate: string;
  endDate: string;
  fetchHistory?: YahooHistoryFetcher;
}): Promise<Array<{ date: string; close: number }>> => {
  const history = await fetchHistory({ symbol: yahooSymbol, startDate, endDate });

  logBackupEvent({
    area: "benchmark",
    outcome: history && history.points.length > 0 ? "used" : "no-data",
    yahooSymbol,
  });

  return history?.points ?? [];
};

const toYahooEtfListing = (item: YahooEtfSearchItem, isin: string | undefined): EtfListing | null => {
  const symbol = normalizeSymbol(item.symbol);
  const name = item.name.trim();

  if (!isPlausibleYahooSymbol(symbol) || !name) {
    return null;
  }

  const ticker = symbol.split(".")[0] ?? symbol;
  const exchangeCode = normalizeSymbol(item.exchange ?? "") || undefined;
  const exchange = item.exchangeDisplay || exchangeCode;
  const instrumentIdentity: InstrumentIdentity = {
    ticker,
    name,
    instrumentType: "ETF",
    exchange,
    exchangeCode,
    // The currency stays unset until `resolveYahooEtfListing` reads it from a
    // live Yahoo quote, so the form does not present a guess as confirmed.
    providerPriceSymbol: symbol,
  };

  return {
    listingId: `${YAHOO_LISTING_ID_PREFIX.toLowerCase()}${symbol}`,
    symbol: ticker,
    name,
    kind: "etf",
    marketCurrency: inferCurrencyFromSymbol(symbol, "USD"),
    provider: "yahoo",
    providerId: symbol,
    providerPriceSymbol: symbol,
    source: "api",
    subtitle: [exchange, "Yahoo"].filter(Boolean).join(" · "),
    isin,
    exchange,
    exchangeCode,
    priceStatus: "unchecked",
    instrumentIdentity,
  };
};

/** Last-resort ETF discovery. Never throws; a failed request is simply no listings. */
export const searchYahooEtfListings = async (
  query: string,
  search: YahooEtfSearcher = searchYahooEtfs
): Promise<EtfListing[]> => {
  const normalizedQuery = normalizeSymbol(query);
  const isin = ISIN_PATTERN.test(normalizedQuery) ? normalizedQuery : undefined;
  const items = await search(query).catch(() => [] as YahooEtfSearchItem[]);
  const listings = items
    .flatMap((item) => {
      const listing = toYahooEtfListing(item, isin);
      return listing ? [listing] : [];
    })
    .slice(0, MAX_YAHOO_ETF_SEARCH_LISTINGS);

  logBackupEvent({
    area: "etf-search",
    outcome: listings.length > 0 ? "used" : "no-data",
    symbol: query,
  });

  return listings;
};

/**
 * Settles the price source of an ETF listing through Yahoo.
 * - A listing found through Yahoo search is checked with a live quote, which
 *   also supplies its real currency.
 * - A listing from OpenFIGI, which EODHD could not resolve, gets a Yahoo symbol
 *   from its Bloomberg venue code. OpenFIGI v3 returns no currency and no ISIN
 *   to compare, so it is accepted only when Yahoo itself calls the symbol an
 *   ETF, and the currency is then taken from Yahoo.
 * `null` means the price source stays unavailable.
 */
export const resolveYahooEtfListing = async (
  listing: EtfListing,
  fetchQuote: YahooQuoteFetcher = fetchYahooQuote
): Promise<EtfListing | null> => {
  const area: BackupArea = "etf-price-source";
  const isYahooListing = isYahooSearchListing(listing);
  const yahooSymbol = isYahooListing
    ? normalizeSymbol(listing.providerId ?? "")
    : toYahooSymbolFromOpenFigiListing(listing);

  if (!yahooSymbol || !isPlausibleYahooSymbol(yahooSymbol)) {
    logBackupEvent({ area, outcome: "skipped", symbol: listing.symbol, reason: "no-yahoo-symbol" });
    return null;
  }

  const verified = await fetchVerifiedYahooQuote(yahooSymbol, fetchQuote);

  if (!verified.quote) {
    logBackupEvent({
      area,
      outcome: "no-data",
      symbol: listing.symbol,
      yahooSymbol,
      reason: verified.reason,
    });
    return null;
  }

  const { quote } = verified;

  if (!isYahooListing && quote.instrumentType !== "ETF") {
    logBackupEvent({
      area,
      outcome: "rejected",
      symbol: listing.symbol,
      yahooSymbol,
      reason: "not-etf",
    });
    return null;
  }

  logBackupEvent({ area, outcome: "used", symbol: listing.symbol, yahooSymbol });

  return {
    ...listing,
    provider: "yahoo",
    providerId: yahooSymbol,
    providerPriceSymbol: yahooSymbol,
    marketCurrency: quote.marketCurrency,
    priceScale: quote.priceScale,
    priceStatus: "available",
    instrumentIdentity: {
      ...listing.instrumentIdentity,
      currency: quote.marketCurrency,
      providerPriceSymbol: yahooSymbol,
    },
  };
};
