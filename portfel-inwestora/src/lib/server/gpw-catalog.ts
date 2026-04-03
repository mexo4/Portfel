import { LOCAL_STOCK_CATALOG } from "@/lib/constants";
import db from "@/lib/server/db";
import { normalizeSymbol } from "@/lib/ticker";
import { normalizeText, uniqueBy } from "@/lib/utils";
import type { AssetSearchResult } from "@/types/portfolio";

type PersistedCatalogItem = {
  symbol: string;
  name: string;
  price?: number | null;
};

type GpwCatalogItem = {
  symbol: string;
  symbolCore: string;
  name: string;
  price: number | null;
  normalizedSymbol: string;
  normalizedName: string;
  normalizedHaystack: string;
};

type GpwCatalogSnapshot = {
  items: GpwCatalogItem[];
  updatedAt: string;
  source: "bootstrap" | "cache" | "stooq";
};

type CacheRow = {
  payload_json: string;
  updated_at: string;
};

const GPW_CATALOG_CACHE_KEY = "gpw-catalog-v1";
const GPW_CATALOG_REFRESH_TTL_MS = 24 * 60 * 60 * 1_000;
const GPW_CATALOG_PAGE_COUNT = 5;
const STOOQ_GPW_LIST_URL = "https://stooq.pl/t/?i=513&v=0&n=1&u=1&f=1&l=";
const STOOQ_GPW_TEXT_FALLBACK_URL = "https://r.jina.ai/http://stooq.pl/t/?i=513&v=0&n=1&u=1&f=1&l=";
const STOOQ_ROW_MARKDOWN_PATTERN =
  /\|\s*\*\*\[([A-Z0-9]{1,6})\]\(https?:\/\/stooq\.pl\/q\/\?s=[^)]+\)\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/gi;
const STOOQ_ROW_HTML_PATTERN =
  /href="\/q\/\?s=([a-z0-9]{1,6})"[^>]*>\s*([^<]+?)\s*<\/a>[\s\S]{0,400}?<\/td>[\s\S]{0,120}?<td[^>]*>\s*([^<|]+?)\s*<\/td>/gi;

let memorySnapshot: GpwCatalogSnapshot | null = null;
let refreshPromise: Promise<GpwCatalogSnapshot | null> | null = null;

const readCacheStatement = db.prepare(
  "SELECT payload_json, updated_at FROM market_cache WHERE key = ?"
);
const writeCacheStatement = db.prepare(`
  INSERT INTO market_cache (key, payload_json, updated_at)
  VALUES (@key, @payloadJson, @updatedAt)
  ON CONFLICT(key) DO UPDATE SET
    payload_json = excluded.payload_json,
    updated_at = excluded.updated_at
`);

const isGpwCatalogSymbol = (symbol: string) => /\.WA$/i.test(symbol);

const normalizeGpwSymbol = (symbol: string) => {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return normalized;
  return isGpwCatalogSymbol(normalized) ? normalized : `${normalized}.WA`;
};

const getSymbolCore = (symbol: string) => normalizeGpwSymbol(symbol).replace(/\.WA$/i, "");

const parsePrice = (value?: string | number | null) => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const normalized = value
    ?.replaceAll("*", "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const createCatalogItem = (symbol: string, name: string, price?: number | null): GpwCatalogItem => {
  const canonicalSymbol = normalizeGpwSymbol(symbol);
  const symbolCore = getSymbolCore(canonicalSymbol);
  const normalizedSymbol = normalizeText(canonicalSymbol);
  const normalizedName = normalizeText(name);

  return {
    symbol: canonicalSymbol,
    symbolCore,
    name: name.trim(),
    price: parsePrice(price),
    normalizedSymbol,
    normalizedName,
    normalizedHaystack: normalizeText(
      [canonicalSymbol, symbolCore, name]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ")
    ),
  };
};

const createSnapshot = (
  items: Array<{ symbol: string; name: string; price?: number | null }>,
  updatedAt: string,
  source: GpwCatalogSnapshot["source"]
): GpwCatalogSnapshot => ({
  items: uniqueBy(
    items
      .filter((item) => item.symbol.trim() && item.name.trim())
      .map((item) => createCatalogItem(item.symbol, item.name, item.price)),
    (item) => item.symbol
  ),
  updatedAt,
  source,
});

const bootstrapSnapshot = (): GpwCatalogSnapshot =>
  createSnapshot(
    LOCAL_STOCK_CATALOG.filter((item) => isGpwCatalogSymbol(item.symbol)).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      price: null,
    })),
    new Date(0).toISOString(),
    "bootstrap"
  );

const isFresh = (updatedAt: string, ttlMs = GPW_CATALOG_REFRESH_TTL_MS) => {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < ttlMs;
};

const hasSnapshotPrices = (snapshot: GpwCatalogSnapshot) =>
  snapshot.items.some((item) => typeof item.price === "number" && item.price > 0);

const loadSnapshotFromDb = () => {
  const row = readCacheStatement.get(GPW_CATALOG_CACHE_KEY) as CacheRow | undefined;

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

const persistSnapshot = (snapshot: GpwCatalogSnapshot) => {
  writeCacheStatement.run({
    key: GPW_CATALOG_CACHE_KEY,
    payloadJson: JSON.stringify({
      items: snapshot.items.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        price: item.price,
      })),
    }),
    updatedAt: snapshot.updatedAt,
  });
};

const getLoadedSnapshot = () => {
  if (memorySnapshot) {
    return memorySnapshot;
  }

  const cachedSnapshot = loadSnapshotFromDb();

  if (cachedSnapshot) {
    memorySnapshot = cachedSnapshot;
    return cachedSnapshot;
  }

  return null;
};

const parseMarkdownRows = (content: string) => {
  const items: PersistedCatalogItem[] = [];

  for (const match of content.matchAll(STOOQ_ROW_MARKDOWN_PATTERN)) {
    const symbol = match[1]?.trim().toUpperCase();
    const name = match[2]?.trim();
    const price = parsePrice(match[3]);

    if (!symbol || !name) {
      continue;
    }

    items.push({
      symbol: `${symbol}.WA`,
      name,
      price,
    });
  }

  return items;
};

const parseHtmlRows = (content: string) => {
  const items: PersistedCatalogItem[] = [];

  for (const match of content.matchAll(STOOQ_ROW_HTML_PATTERN)) {
    const symbol = match[1]?.trim().toUpperCase();
    const linkLabel = match[2]?.trim();
    const name = match[3]?.trim();

    if (!symbol || !name || linkLabel?.toUpperCase() !== symbol) {
      continue;
    }

    items.push({
      symbol: `${symbol}.WA`,
      name,
      price: null,
    });
  }

  return items;
};

const parseStooqCatalogPage = (content: string) => {
  const markdownItems = parseMarkdownRows(content);
  if (markdownItems.length > 0) {
    return markdownItems;
  }

  return parseHtmlRows(content);
};

const fetchCatalogPage = async (pageNumber: number, timeoutMs: number) => {
  const pageUrl = `${STOOQ_GPW_LIST_URL}${pageNumber}`;
  const response = await fetch(pageUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (response?.ok) {
    const content = await response.text();
    const parsedItems = parseStooqCatalogPage(content);

    if (parsedItems.length > 0) {
      return parsedItems;
    }
  }

  const fallbackResponse = await fetch(`${STOOQ_GPW_TEXT_FALLBACK_URL}${pageNumber}`, {
    headers: {
      Accept: "text/plain",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (!fallbackResponse?.ok) {
    return [];
  }

  return parseStooqCatalogPage(await fallbackResponse.text());
};

const fetchFreshSnapshot = async () => {
  const pageNumbers = Array.from({ length: GPW_CATALOG_PAGE_COUNT }, (_, index) => index + 1);
  const pageResults = await Promise.all(pageNumbers.map((pageNumber) => fetchCatalogPage(pageNumber, 20_000)));
  const rawItems = uniqueBy(pageResults.flat(), (item) => item.symbol);

  if (rawItems.length === 0) {
    return null;
  }

  return createSnapshot(rawItems, new Date().toISOString(), "stooq");
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
    persistSnapshot(refreshedSnapshot);
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

const getAvailableSnapshot = () => {
  const snapshot = getLoadedSnapshot();

  if (snapshot) {
    if (!isFresh(snapshot.updatedAt) || !hasSnapshotPrices(snapshot)) {
      void refreshSnapshotInBackground();
    }

    return snapshot;
  }

  void refreshSnapshotInBackground();
  return bootstrapSnapshot();
};

const getMatchScore = (item: GpwCatalogItem, query: string, normalizedQuery: string) => {
  const upperQuery = query.trim().toUpperCase();
  const canonicalQuery = normalizeGpwSymbol(query);

  if (item.symbol === canonicalQuery) return 0;
  if (item.symbolCore === upperQuery) return 1;
  if (item.normalizedSymbol === normalizedQuery) return 2;
  if (item.normalizedName === normalizedQuery) return 3;
  if (item.symbolCore.startsWith(upperQuery)) return 4;
  if (item.name.toUpperCase().startsWith(upperQuery)) return 5;
  if (item.normalizedName.startsWith(normalizedQuery)) return 6;
  return 7;
};

export const searchGpwCatalog = async (query: string): Promise<AssetSearchResult[]> => {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  const snapshot = getAvailableSnapshot();

  return snapshot.items
    .filter((item) => item.normalizedHaystack.includes(normalizedQuery))
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
      subtitle: "GPW / Stooq",
      source: "catalog" as const,
    }));
};

export const findGpwCatalogEntry = (symbol: string) => {
  const normalizedSymbol = normalizeGpwSymbol(symbol);

  if (!normalizedSymbol) {
    return null;
  }

  return (
    getAvailableSnapshot().items.find((item) => item.symbol === normalizedSymbol) ?? null
  );
};

export const findGpwCatalogEntryWithPrice = async (symbol: string) => {
  const normalizedSymbol = normalizeGpwSymbol(symbol);

  if (!normalizedSymbol) {
    return null;
  }

  const snapshot = getAvailableSnapshot();
  const currentEntry =
    snapshot.items.find((item) => item.symbol === normalizedSymbol) ?? null;

  if (currentEntry?.price) {
    return currentEntry;
  }

  const refreshedSnapshot = await refreshSnapshotInBackground();

  if (!refreshedSnapshot) {
    return currentEntry;
  }

  return (
    refreshedSnapshot.items.find((item) => item.symbol === normalizedSymbol) ?? currentEntry
  );
};

export const warmGpwCatalog = () => {
  const snapshot = getLoadedSnapshot();

  if (!snapshot || !isFresh(snapshot.updatedAt)) {
    void refreshSnapshotInBackground();
  }
};
