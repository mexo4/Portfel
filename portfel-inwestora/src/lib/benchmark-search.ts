import { ETF_PRICE_SOURCE_EXCHANGE_CODES } from "@/lib/etf-price-venues";
import { normalizeGpwSymbol, normalizeSymbol } from "@/lib/ticker";
import { normalizeText } from "@/lib/utils";
import type {
  AssetSearchMode,
  AssetSearchResult,
  CurrencyCode,
  PortfolioBenchmarkDefinition,
} from "@/types/portfolio";

/**
 * Benchmark discovery is intentionally separate from normal asset discovery.
 * These are stable, non-purchasable index definitions used only to build a
 * comparison series.  They therefore never enter the add-asset workflow.
 */
export const BENCHMARK_SEARCH_RESULT_LIMIT = 10;

type CoreBenchmark = AssetSearchResult & {
  aliases: string[];
};

const makeIndex = ({
  symbol,
  name,
  marketCurrency,
  providerId = symbol,
  aliases,
  subtitle,
}: {
  symbol: string;
  name: string;
  marketCurrency: CurrencyCode;
  providerId?: string;
  aliases: string[];
  subtitle: string;
}): CoreBenchmark => ({
  symbol,
  name,
  kind: "stock",
  marketCurrency,
  provider: "yahoo",
  providerId,
  source: "catalog",
  subtitle,
  aliases,
});

/**
 * Only broadly understood market indices belong here.  This is a benchmark
 * catalogue, not an asset-search exception list: each definition has an
 * explicit provider symbol used by the existing history resolver.
 */
export const CORE_BENCHMARKS: readonly CoreBenchmark[] = [
  makeIndex({
    symbol: "^GSPC",
    name: "S&P 500",
    marketCurrency: "USD",
    aliases: ["s&p 500", "s&p500", "sp 500", "sp500", "gspc"],
    subtitle: "Indeks · USA · USD",
  }),
  makeIndex({
    symbol: "^NDX",
    name: "Nasdaq 100",
    marketCurrency: "USD",
    aliases: ["nasdaq 100", "nasdaq100", "ndx"],
    subtitle: "Indeks · USA · USD",
  }),
  makeIndex({
    symbol: "^DJI",
    name: "Dow Jones Industrial Average",
    marketCurrency: "USD",
    aliases: ["dow jones", "djia", "dji"],
    subtitle: "Indeks · USA · USD",
  }),
  makeIndex({
    symbol: "^GDAXI",
    name: "DAX",
    marketCurrency: "EUR",
    aliases: ["dax", "gdaxi", "dax 40"],
    subtitle: "Indeks · Niemcy · EUR",
  }),
];

const compact = (value: string) => normalizeText(value).replaceAll(" ", "");

const getCoreSearchScore = (benchmark: CoreBenchmark, query: string) => {
  const normalizedQuery = normalizeText(query);
  const compactQuery = compact(query);
  const normalizedName = normalizeText(benchmark.name);
  const normalizedSymbol = normalizeText(benchmark.symbol);
  const aliases = benchmark.aliases.map(normalizeText);
  const compactAliases = aliases.map(compact);

  if (
    normalizedName === normalizedQuery ||
    normalizedSymbol === normalizedQuery ||
    aliases.includes(normalizedQuery) ||
    compactAliases.includes(compactQuery)
  ) {
    return 0;
  }

  if (
    normalizedName.startsWith(normalizedQuery) ||
    aliases.some((alias) => alias.startsWith(normalizedQuery)) ||
    compactAliases.some((alias) => alias.startsWith(compactQuery))
  ) {
    return 1;
  }

  if (
    normalizedName.includes(normalizedQuery) ||
    aliases.some((alias) => alias.includes(normalizedQuery))
  ) {
    return 2;
  }

  return Number.POSITIVE_INFINITY;
};

const getExternalSearchScore = (result: AssetSearchResult, query: string) => {
  const normalizedQuery = normalizeText(query);
  const compactQuery = compact(query);
  const normalizedName = normalizeText(result.name);
  const normalizedSymbol = normalizeText(result.symbol);

  if (normalizedSymbol === normalizedQuery || compact(result.symbol) === compactQuery) return 3;
  if (normalizedName === normalizedQuery || compact(result.name) === compactQuery) return 4;
  if (normalizedSymbol.startsWith(normalizedQuery)) return 5;
  if (normalizedName.startsWith(normalizedQuery)) return 6;
  if (normalizedName.includes(normalizedQuery)) return 7;
  return 8;
};

const getEtfExchangeCode = (result: AssetSearchResult) =>
  normalizeSymbol(result.instrumentIdentity?.exchangeCode ?? "");

/**
 * An OpenFIGI ETF listing has no price-provider id; it gets one only when its
 * venue can be translated (see `ETF_PRICE_SOURCE_EXCHANGE_CODES`). Listings that
 * already carry a `providerId` (catalogue, EODHD, Yahoo) need no translation.
 */
export const needsEtfPriceSourceResolution = (result: AssetSearchResult) =>
  result.kind === "etf" && !result.providerId?.trim() && Boolean(result.instrumentIdentity);

/**
 * A benchmark needs a price series, so a listing whose venue can never be given
 * a price source is a dead choice. They are kept (the user may still look for
 * that ticker) but always after the listings that can work.
 */
export const hasUnresolvableEtfVenue = (result: AssetSearchResult) =>
  needsEtfPriceSourceResolution(result) &&
  !ETF_PRICE_SOURCE_EXCHANGE_CODES.has(getEtfExchangeCode(result));

const getResultIdentity = (result: AssetSearchResult) =>
  [
    result.kind,
    result.provider,
    normalizeSymbol(result.providerId ?? result.symbol),
    result.marketCurrency,
    // One fund is listed on many venues, often in one currency. They are
    // different price sources, so a venue that can work must not be hidden
    // behind another listing of the same ticker. Dead venues collapse to one.
    needsEtfPriceSourceResolution(result) && !hasUnresolvableEtfVenue(result)
      ? getEtfExchangeCode(result)
      : "",
  ].join(":");

/**
 * Produces a calm, small list for benchmark selection.  Provider results are
 * not trusted for ordering and ETF listings are deduplicated before the cap.
 */
export const rankBenchmarkSearchResults = (
  query: string,
  externalResults: AssetSearchResult[] = []
): AssetSearchResult[] => {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) return [];

  const rankedCore = CORE_BENCHMARKS.map((benchmark) => ({
    result: benchmark satisfies AssetSearchResult,
    score: getCoreSearchScore(benchmark, query),
  })).filter((entry) => Number.isFinite(entry.score));

  const rankedExternal = externalResults.map((result) => ({
    result,
    score: getExternalSearchScore(result, query),
  }));

  const ranked = [...rankedCore, ...rankedExternal];
  // A ticker that has at least one workable venue does not also list its dead
  // venues: with a dozen MTF codes per fund they would crowd out the real
  // results and the cap below would cut the workable listing off.
  const workableEtfSymbols = new Set(
    ranked
      .filter(({ result }) => needsEtfPriceSourceResolution(result) && !hasUnresolvableEtfVenue(result))
      .map(({ result }) => normalizeSymbol(result.symbol))
  );
  const seen = new Set<string>();

  return ranked
    .filter(
      ({ result }) =>
        !hasUnresolvableEtfVenue(result) || !workableEtfSymbols.has(normalizeSymbol(result.symbol))
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        Number(hasUnresolvableEtfVenue(left.result)) - Number(hasUnresolvableEtfVenue(right.result)) ||
        left.result.name.localeCompare(right.result.name, "pl") ||
        left.result.symbol.localeCompare(right.result.symbol) ||
        getEtfExchangeCode(left.result).localeCompare(getEtfExchangeCode(right.result))
    )
    .filter(({ result }) => {
      const identity = getResultIdentity(result);

      if (seen.has(identity)) return false;

      seen.add(identity);
      return true;
    })
    .slice(0, BENCHMARK_SEARCH_RESULT_LIMIT)
    .map(({ result }) => result);
};

export const hasExactCoreBenchmarkMatch = (query: string) =>
  CORE_BENCHMARKS.some((benchmark) => getCoreSearchScore(benchmark, query) === 0);

/**
 * A benchmark is comparison-only, never a purchased position.  In
 * particular, its quote currency must remain provider metadata and is not a
 * reason to reject a selection from a portfolio with another base currency.
 */
export const createPortfolioBenchmarkDefinition = (
  result: AssetSearchResult,
  mode: AssetSearchMode
): PortfolioBenchmarkDefinition => {
  const symbol = mode === "stock-gpw" ? normalizeGpwSymbol(result.symbol) : normalizeSymbol(result.symbol);
  const providerIdentity = normalizeSymbol(result.providerId ?? symbol);

  return {
    id: [result.kind, result.provider, providerIdentity].join(":"),
    name: result.name,
    symbol,
    kind: result.kind,
    marketCurrency: result.marketCurrency,
    provider: result.provider,
    providerId: result.providerId,
    priceScale: result.priceScale,
  };
};
