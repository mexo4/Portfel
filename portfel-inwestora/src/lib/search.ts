import {
  KIND_LABELS,
  LOCAL_STOCK_CATALOG,
  SEARCH_MODE_OPTIONS,
} from "@/lib/constants";
import {
  getGpwTickerCore,
  isGpwSymbol,
  normalizeGpwSymbol,
} from "@/lib/ticker";
import { normalizeText, uniqueBy } from "@/lib/utils";
import type {
  AssetCatalogItem,
  AssetKind,
  AssetSearchMode,
  AssetSearchResult,
} from "@/types/portfolio";

const SEARCH_RESULT_LIMIT = 16;

export const getMinimumSearchLength = (mode: AssetSearchMode) => {
  if (mode === "stock-global" || mode === "stock-gpw" || mode === "etf") {
    return 1;
  }

  return 2;
};

export const getSearchPlaceholder = (mode: AssetSearchMode) => {
  if (mode === "stock-global") return "Np. Apple, NVIDIA, Microsoft";
  if (mode === "stock-gpw") return "Np. XTB, Orlen, PZU";
  if (mode === "etf") return "Np. VWCE, SXR8, SPY";
  return "Np. bitcoin, solana, BTC";
};

export const getKindLabel = (kind: AssetKind) => KIND_LABELS[kind];

export const getModeConfig = (mode: AssetSearchMode) =>
  SEARCH_MODE_OPTIONS.find((option) => option.value === mode) ?? SEARCH_MODE_OPTIONS[0];

const isGpwCatalogSymbol = (symbol: string) => isGpwSymbol(symbol);
const getGpwSymbolCore = (symbol: string) => getGpwTickerCore(symbol);

const getGpwAliasTerms = (symbol: string) => {
  if (!isGpwCatalogSymbol(symbol)) {
    return [];
  }

  const tickerCore = getGpwSymbolCore(symbol);

  if (!tickerCore) {
    return [];
  }

  return [tickerCore, `${tickerCore}.WA`, `${tickerCore}.PL`];
};

const getCatalogEntries = (
  kind: AssetKind,
  mode?: AssetSearchMode
): AssetCatalogItem[] => {
  if (kind === "etf" || mode === "etf") {
    return [];
  }

  if (kind !== "stock") {
    return [];
  }

  if (mode === "stock-gpw") {
    return LOCAL_STOCK_CATALOG.filter((item) => isGpwCatalogSymbol(item.symbol));
  }

  if (mode === "stock-global") {
    return LOCAL_STOCK_CATALOG.filter((item) => !isGpwCatalogSymbol(item.symbol));
  }

  return LOCAL_STOCK_CATALOG;
};

const getCatalogMatchScore = (
  item: AssetCatalogItem,
  query: string,
  normalizedQuery: string
) => {
  const upperQuery = query.trim().toUpperCase();
  const normalizedSymbol = normalizeText(item.symbol);
  const normalizedName = normalizeText(item.name);
  const normalizedTerms = item.searchTerms.map((term) => normalizeText(term));
  const itemGpwCore = isGpwCatalogSymbol(item.symbol) ? getGpwSymbolCore(item.symbol) : "";
  const queryGpwCore = itemGpwCore ? getGpwSymbolCore(upperQuery) : "";

  if (item.symbol === upperQuery) return 0;
  if (itemGpwCore && itemGpwCore === queryGpwCore) return 1;
  if (normalizedSymbol === normalizedQuery) return 1;
  if (normalizedName === normalizedQuery) return 2;
  if (normalizedTerms.some((term) => term === normalizedQuery)) return 3;
  if (itemGpwCore && itemGpwCore.startsWith(queryGpwCore) && queryGpwCore) return 4;
  if (item.symbol.startsWith(upperQuery)) return 5;
  if (normalizedName.startsWith(normalizedQuery)) return 6;
  return 7;
};

export const searchCatalogAssets = (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): AssetSearchResult[] => {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  return getCatalogEntries(kind, mode)
    .filter((item) => {
      const haystack = normalizeText(
        [item.name, item.symbol, item.subtitle, ...item.searchTerms, ...getGpwAliasTerms(item.symbol)]
          .join(" ")
      );

      return haystack.includes(normalizedQuery);
    })
    .sort(
      (left, right) =>
        getCatalogMatchScore(left, query, normalizedQuery) -
          getCatalogMatchScore(right, query, normalizedQuery) ||
        left.name.localeCompare(right.name, "pl")
    )
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      kind: item.kind,
      marketCurrency: item.marketCurrency,
      provider: item.provider,
      providerId: item.providerId,
      subtitle: item.subtitle,
      source: "catalog" as const,
    }));
};

export const isLikelyTickerInput = (query: string) => {
  const trimmed = query.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!/^[a-z0-9.-]{1,12}$/i.test(trimmed)) return false;
  if (/[.-]/.test(trimmed) || /\d/.test(trimmed)) return true;
  if (!/^[a-z]+$/i.test(trimmed)) return false;
  if (trimmed.length <= 3) return true;
  if (trimmed === trimmed.toUpperCase() && trimmed.length <= 5) return true;
  return false;
};

const isExplicitTickerInput = (query: string) => {
  const trimmed = query.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /[.-]/.test(trimmed) || /\d/.test(trimmed) || trimmed === trimmed.toUpperCase();
};

export const buildTickerFallbackResults = (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): AssetSearchResult[] => {
  if (kind !== "stock" && kind !== "etf") return [];
  if (!isLikelyTickerInput(query)) return [];

  if (
    (mode === "stock-gpw" || mode === "stock-global") &&
    !isExplicitTickerInput(query)
  ) {
    return [];
  }

  const normalized = query.trim().toUpperCase();

  const candidates: AssetSearchResult[] = [];

  if (mode === "stock-gpw") {
    const canonicalSymbol = normalizeGpwSymbol(normalized);

    candidates.push({
      symbol: canonicalSymbol,
      name: getGpwTickerCore(canonicalSymbol),
      kind: "stock",
      marketCurrency: "PLN",
      provider: "stooq",
      subtitle: "Ticker GPW / Stooq",
      source: "fallback",
    });
  }

  if (mode === "stock-global") {
    return candidates;
  }

  if (kind === "etf" || mode === "etf") {
    return candidates;
  }

  return candidates;
};

const getSearchResultDeduplicationKey = (item: AssetSearchResult) => {
  if (item.kind === "stock" && isGpwSymbol(item.symbol)) {
    return `stock:gpw:${getGpwTickerCore(item.symbol)}`;
  }

  return `${item.symbol}|${item.providerId ?? ""}|${item.kind}|${item.provider}`;
};

export const mergeSearchResults = (items: AssetSearchResult[]) =>
  uniqueBy(items, getSearchResultDeduplicationKey).slice(0, SEARCH_RESULT_LIMIT);

const getSourcePriority = (item: AssetSearchResult) => {
  if (item.source === "catalog") return 0;
  if (item.source === "api") return 1;
  return 2;
};

const getSearchResultMatchScore = (
  query: string,
  item: AssetSearchResult,
  options?: {
    mode?: AssetSearchMode;
    preferSymbol?: boolean;
  }
) => {
  const normalizedQueryText = normalizeText(query);
  const normalizedQuerySymbol = query.trim().toUpperCase();
  const normalizedItemName = normalizeText(item.name);
  const normalizedItemSymbol = item.symbol.trim().toUpperCase();
  const normalizedItemIsin = item.isin?.trim().toUpperCase() ?? "";
  const queryGpwCore = getGpwSymbolCore(normalizedQuerySymbol);
  const itemGpwCore = getGpwSymbolCore(normalizedItemSymbol);
  const isGpwLookup = options?.mode === "stock-gpw";

  if (options?.preferSymbol) {
    if (isGpwLookup && itemGpwCore === queryGpwCore) return 0;
    if (normalizedItemSymbol === normalizedQuerySymbol) return 0;
    if (normalizedItemIsin === normalizedQuerySymbol) return 1;
    if (normalizedItemName === normalizedQueryText) return 2;
    if (normalizedItemName.startsWith(normalizedQueryText)) return 3;
    if (normalizedItemSymbol.startsWith(normalizedQuerySymbol)) return 4;
    if (isGpwLookup && itemGpwCore.startsWith(queryGpwCore)) return 5;
    return Number.POSITIVE_INFINITY;
  }

  if (normalizedItemName === normalizedQueryText) return 0;
  if (normalizedItemSymbol === normalizedQuerySymbol) return 1;
  if (normalizedItemIsin === normalizedQuerySymbol) return 2;
  if (isGpwLookup && itemGpwCore === queryGpwCore) return 3;
  if (normalizedItemName.startsWith(normalizedQueryText)) return 4;
  if (normalizedItemSymbol.startsWith(normalizedQuerySymbol)) return 5;
  if (isGpwLookup && itemGpwCore.startsWith(queryGpwCore)) return 6;
  return Number.POSITIVE_INFINITY;
};

export const pickBestSearchResult = (
  query: string,
  items: AssetSearchResult[],
  options?: {
    allowFirstItemFallback?: boolean;
    mode?: AssetSearchMode;
    preferSymbol?: boolean;
  }
) => {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return null;
  }

  const rankedItems = items
    .map((item) => ({
      item,
      score: getSearchResultMatchScore(trimmedQuery, item, options),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort(
      (left, right) =>
        left.score - right.score ||
        getSourcePriority(left.item) - getSourcePriority(right.item) ||
        left.item.name.localeCompare(right.item.name, "pl")
    );

  if (rankedItems.length > 0) {
    return rankedItems[0].item;
  }

  return options?.allowFirstItemFallback ? (items[0] ?? null) : null;
};
