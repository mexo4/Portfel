import { LOCAL_STOCK_CATALOG } from "@/lib/constants";
import { queryOne } from "@/lib/server/db";
import { setMarketCachePayload } from "@/lib/server/market-cache";
import { fetchWithSystemTrust } from "@/lib/server/system-trust-fetch";
import {
  getGpwTickerCore,
  isGpwSymbol,
  normalizeGpwSymbol,
} from "@/lib/ticker";
import { normalizeText, uniqueBy } from "@/lib/utils";
import type { AssetSearchResult } from "@/types/portfolio";

type PersistedCatalogItem = {
  symbol: string;
  name: string;
  isin?: string;
};

type GpwCatalogItem = {
  symbol: string;
  symbolCore: string;
  name: string;
  normalizedSymbol: string;
  normalizedName: string;
  normalizedHaystack: string;
  isin?: string;
};

type GpwCatalogSnapshot = {
  items: GpwCatalogItem[];
  updatedAt: string;
  source: "bootstrap" | "cache" | "gpw";
};

type CacheRow = {
  payload_json: string;
  updated_at: string;
};

// v2 invalidates incomplete snapshots produced by the retired Stooq page scraper.
const GPW_CATALOG_CACHE_KEY = "gpw-catalog-v2";
const GPW_CATALOG_REFRESH_TTL_MS = 24 * 60 * 60 * 1_000;
const GPW_LIST_URL =
  "https://www.gpw.pl/ajaxindex.php?action=GPWQuotations&start=showTable&tab=all&lang=PL&type=&full=1&format=html";
const IGNORED_COMPANY_QUERY_WORDS = new Set([
  "grupa",
  "polska",
  "poland",
  "spolka",
  "akcyjna",
  "holding",
]);

let memorySnapshot: GpwCatalogSnapshot | null = null;
let refreshPromise: Promise<GpwCatalogSnapshot | null> | null = null;

const isGpwCatalogSymbol = (symbol: string) => isGpwSymbol(symbol);

const getSymbolCore = (symbol: string) => getGpwTickerCore(symbol);

const LOCAL_GPW_ITEM_BY_CORE = new Map(
  LOCAL_STOCK_CATALOG.filter((item) => isGpwCatalogSymbol(item.symbol)).map((item) => [
    getSymbolCore(item.symbol),
    item,
  ])
);

const createCatalogItem = (symbol: string, name: string, isin?: string): GpwCatalogItem => {
  const symbolCore = getSymbolCore(symbol);
  const localCatalogItem = LOCAL_GPW_ITEM_BY_CORE.get(symbolCore);
  const displaySymbol = localCatalogItem
    ? normalizeGpwSymbol(localCatalogItem.symbol)
    : normalizeGpwSymbol(symbol);
  const displayName = localCatalogItem?.name?.trim() || name.trim();
  const normalizedSymbol = normalizeText(displaySymbol);
  const normalizedName = normalizeText(displayName);

  return {
    symbol: displaySymbol,
    symbolCore,
    name: displayName,
    normalizedSymbol,
    normalizedName,
    normalizedHaystack: normalizeText(
      [displaySymbol, symbolCore, `${symbolCore}.WA`, `${symbolCore}.PL`, displayName, name, isin]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim())
        .join(" ")
    ),
    isin: isin?.trim().toUpperCase() || undefined,
  };
};

const createSnapshot = (
  items: Array<{ symbol: string; name: string; isin?: string }>,
  updatedAt: string,
  source: GpwCatalogSnapshot["source"]
): GpwCatalogSnapshot => ({
  items: uniqueBy(
    items
      .filter((item) => item.symbol.trim() && item.name.trim())
      .map((item) => createCatalogItem(item.symbol, item.name, item.isin)),
    (item) => item.symbolCore
  ),
  updatedAt,
  source,
});

const bootstrapSnapshot = (): GpwCatalogSnapshot =>
  createSnapshot(
    LOCAL_STOCK_CATALOG.filter((item) => isGpwCatalogSymbol(item.symbol)).map((item) => ({
      symbol: item.symbol,
      name: item.name,
    })),
    new Date(0).toISOString(),
    "bootstrap"
  );

const isFresh = (updatedAt: string, ttlMs = GPW_CATALOG_REFRESH_TTL_MS) => {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < ttlMs;
};

const loadSnapshotFromDb = async () => {
  const row = await queryOne<CacheRow>(
    'SELECT payload_json, updated_at FROM market_cache WHERE "key" = $1',
    [GPW_CATALOG_CACHE_KEY]
  );

  if (!row?.payload_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.payload_json) as {
      items?: PersistedCatalogItem[];
    };
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

    if (rawItems.length === 0) {
      return null;
    }

    return createSnapshot(rawItems, row.updated_at, "cache");
  } catch {
    return null;
  }
};

const persistSnapshot = (snapshot: GpwCatalogSnapshot) =>
  setMarketCachePayload(
    GPW_CATALOG_CACHE_KEY,
    {
      items: snapshot.items.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        isin: item.isin,
      })),
    },
    snapshot.updatedAt
  );

const getLoadedSnapshot = async () => {
  if (memorySnapshot) {
    return memorySnapshot;
  }

  const cachedSnapshot = await loadSnapshotFromDb();

  if (cachedSnapshot) {
    memorySnapshot = cachedSnapshot;
    return cachedSnapshot;
  }

  return null;
};

const decodeHtmlText = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();

export const parseGpwOfficialCatalog = (content: string) => {
  const items: PersistedCatalogItem[] = [];

  for (const row of content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row[1]?.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? []).map(
      (cell) => decodeHtmlText(cell[1] ?? "")
    );
    const name = cells[2]?.trim();
    const isin = cells[3]?.trim().toUpperCase();
    const symbol = cells[4]?.trim().toUpperCase();
    const currency = cells[5]?.trim().toUpperCase();

    if (
      !symbol ||
      !name ||
      !/^[A-Z0-9]{1,8}$/.test(symbol) ||
      currency !== "PLN"
    ) {
      continue;
    }

    items.push({
      symbol: `${symbol}.WA`,
      name,
      isin: /^[A-Z]{2}[A-Z0-9]{10}$/.test(isin ?? "") ? isin : undefined,
    });
  }

  return items;
};

const fetchOfficialCatalog = async (timeoutMs: number) => {
  const response = await fetchWithSystemTrust(GPW_LIST_URL, {
    // GPW closes anonymous HTTP clients before returning the public table.
    // Identify Mexo truthfully; this is not browser impersonation and does
    // not bypass any access restriction.
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mexo/1.0 (+https://mexo.com.pl; GPW catalogue refresh)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  return response?.ok ? parseGpwOfficialCatalog(await response.text()) : [];
};

const fetchFreshSnapshot = async () => {
  const rawItems = uniqueBy(await fetchOfficialCatalog(20_000), (item) => item.symbol);

  if (rawItems.length === 0) {
    return null;
  }

  return createSnapshot(rawItems, new Date().toISOString(), "gpw");
};

const refreshSnapshotInBackground = () => {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshedSnapshot = await fetchFreshSnapshot();

    if (!refreshedSnapshot) {
      return null;
    }

    memorySnapshot = refreshedSnapshot;
    await persistSnapshot(refreshedSnapshot);
    return refreshedSnapshot;
  })()
    .catch((error) => {
      console.error("GPW catalog refresh failed", error);
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
};

const getAvailableSnapshot = async () => {
  const snapshot = await getLoadedSnapshot();

  if (snapshot) {
    if (!isFresh(snapshot.updatedAt)) {
      void refreshSnapshotInBackground();
    }

    return snapshot;
  }

  return (await refreshSnapshotInBackground()) ?? bootstrapSnapshot();
};

const getMatchScore = (item: GpwCatalogItem, query: string, normalizedQuery: string) => {
  const upperQuery = query.trim().toUpperCase();
  const queryCore = getSymbolCore(query);
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const compactName = item.normalizedName.replace(/\s+/g, "");

  if (item.symbol === normalizeGpwSymbol(query)) return 0;
  if (item.symbolCore === queryCore) return 1;
  if (item.symbolCore === upperQuery) return 1;
  if (item.normalizedSymbol === normalizedQuery) return 2;
  if (item.normalizedName === normalizedQuery) return 3;
  if (compactName === compactQuery) return 3;
  if (compactName.length >= 3 && compactQuery.startsWith(compactName)) return 4;
  if (queryCore && item.symbolCore.startsWith(queryCore)) return 5;
  if (item.name.toUpperCase().startsWith(upperQuery)) return 6;
  if (item.normalizedName.startsWith(normalizedQuery)) return 7;
  return 8;
};

export const searchGpwCatalogItems = (
  items: Array<{ symbol: string; name: string; isin?: string }>,
  query: string
): AssetSearchResult[] => {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  const catalogItems = createSnapshot(items, new Date(0).toISOString(), "bootstrap").items;

  const queryWords = normalizedQuery
    .split(" ")
    .filter((word) => word.length >= 3 && !IGNORED_COMPANY_QUERY_WORDS.has(word));

  return catalogItems
    .filter(
      (item) =>
        item.normalizedHaystack.includes(normalizedQuery) ||
        queryWords.some((word) => item.normalizedHaystack.includes(word))
    )
    .sort(
      (left, right) =>
        getMatchScore(left, query, normalizedQuery) - getMatchScore(right, query, normalizedQuery) ||
        left.name.localeCompare(right.name, "pl")
    )
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      kind: "stock" as const,
      marketCurrency: "PLN" as const,
      provider: "stooq" as const,
      subtitle: "GPW",
      source: "catalog" as const,
      isin: item.isin,
    }));
};

export const searchGpwCatalog = async (query: string): Promise<AssetSearchResult[]> => {
  const snapshot = await getAvailableSnapshot();
  return searchGpwCatalogItems(snapshot.items, query);
};

export const findGpwCatalogEntry = async (symbol: string) => {
  const symbolCore = getSymbolCore(symbol);

  if (!symbolCore) {
    return null;
  }

  const snapshot = await getAvailableSnapshot();
  return snapshot.items.find((item) => item.symbolCore === symbolCore) ?? null;
};

/** Resolve an issuer by the exchange-issued identity carried by PAP ESPI. */
export const findGpwCatalogEntryByIsin = async (isin: string) => {
  const normalizedIsin = isin.trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(normalizedIsin)) return null;
  const snapshot = await getAvailableSnapshot();
  return snapshot.items.find((item) => item.isin === normalizedIsin) ?? null;
};

const normalizeIssuerNameForIdentity = (value: string) =>
  normalizeText(value)
    .replace(/\b(?:spolka akcyjna|s a|sa|se)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Strict fallback for PAP periodic reports that omit the issuer tag entirely.
 * It accepts only one exact official-catalog name after removing legal suffixes;
 * it never performs fuzzy or substring issuer matching.
 */
export const findGpwCatalogEntryByExactName = async (companyName: string) => {
  const normalizedName = normalizeIssuerNameForIdentity(companyName);
  if (!normalizedName) return null;
  const snapshot = await getAvailableSnapshot();
  const matches = snapshot.items.filter(
    (item) => normalizeIssuerNameForIdentity(item.name) === normalizedName
  );
  return matches.length === 1 ? matches[0]! : null;
};

export const warmGpwCatalog = async () => {
  const snapshot = await getLoadedSnapshot();

  if (!snapshot || !isFresh(snapshot.updatedAt)) {
    void refreshSnapshotInBackground();
  }
};
