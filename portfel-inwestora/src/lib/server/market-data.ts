import {
  LOCAL_ETF_CATALOG,
  LOCAL_STOCK_CATALOG,
} from "@/lib/constants";
import { inferCurrencyFromSymbol, normalizeSymbol } from "@/lib/ticker";
import { normalizeText, round, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  AssetCatalogItem,
  AssetKind,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  CurrencyCode,
  QuoteProvider,
} from "@/types/portfolio";

type FinnhubSearchResponse = {
  result?: Array<{
    symbol?: string;
    description?: string;
    displaySymbol?: string;
    type?: string;
  }>;
};

type FinnhubQuoteResponse = {
  c?: number;
};

type FinnhubProfileResponse = {
  country?: string;
  currency?: string;
  exchange?: string;
  name?: string;
};

type StooqQuoteResponse = {
  symbols?: Array<{
    symbol?: string;
    date?: string;
    time?: string;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  }>;
};

type CoinGeckoSearchResponse = {
  coins?: Array<{
    id?: string;
    name?: string;
    symbol?: string;
  }>;
};

type CommoditySymbolPayload = {
  symbols?:
    | Array<{
        symbol?: string;
        category?: string;
        name?: string;
        status?: string;
        currency?: {
          code?: string;
        };
        unit?: {
          symbol?: string;
          name?: string;
        };
      }>
    | Record<
        string,
        {
          symbol?: string;
          category?: string;
          name?: string;
          status?: string;
          currency?: {
            code?: string;
          };
          unit?: {
            symbol?: string;
            name?: string;
          };
        }
      >;
};

const FINNHUB_API_KEY =
  process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? "";
const COMMODITY_API_KEY =
  process.env.COMMODITY_PRICE_API_KEY ??
  process.env.NEXT_PUBLIC_COMMODITY_API_KEY ??
  "";

const isGpwSymbol = (symbol: string) => /\.WA$/i.test(symbol);
const isEuropeanEtfSymbol = (symbol: string) => /\.(AS|DE|DU|F|HM|MI|MU)$/i.test(symbol);
const shouldUseStooqForGpwStock = ({
  symbol,
  kind,
  marketCurrency,
  provider,
}: {
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
}) =>
  kind === "stock" &&
  (provider === "stooq" || marketCurrency === "PLN" || isGpwSymbol(symbol));

const getEtfProvider = (symbol: string): QuoteProvider =>
  isEuropeanEtfSymbol(symbol) ? "stooq" : "finnhub";

const isUsFinnhubSymbol = (symbol: string) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol);

const isStockLikeFinnhubType = (type?: string) => {
  const normalizedType = normalizeText(type ?? "");
  if (!normalizedType) return true;

  return (
    normalizedType.includes("common stock") ||
    normalizedType.includes("ordinary share") ||
    normalizedType.includes("adr")
  );
};

const isEtfLikeFinnhubType = (type?: string) => {
  const normalizedType = normalizeText(type ?? "");
  if (!normalizedType) return true;

  return (
    normalizedType.includes("etf") ||
    normalizedType.includes("exchange traded fund") ||
    normalizedType.includes("fund") ||
    normalizedType.includes("etn") ||
    normalizedType.includes("etp")
  );
};

const getStooqSymbolCandidates = (symbol: string) => {
  const normalized = symbol.trim().toLowerCase();

  if (isGpwSymbol(normalized)) {
    const withoutSuffix = normalized.replace(/\.wa$/i, "");

    return uniqueBy(
      [normalized, withoutSuffix, normalized.toUpperCase(), withoutSuffix.toUpperCase()],
      (item) => item
    );
  }

  return uniqueBy(
    [
      `${normalized}.wa`,
      normalized,
      `${normalized}.wa`.toUpperCase(),
      normalized.toUpperCase(),
    ],
    (item) => item
  );
};

const STOOQ_DOMAINS = ["https://stooq.pl", "https://stooq.com"] as const;
const STOOQ_TEXT_PROXY_URL = "https://r.jina.ai/http://stooq.pl/q/?s=";

const parseStooqPageNumber = (value: string) => {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? round(parsed) : null;
};

const getStooqPageSymbolCandidates = (symbol: string) => {
  const normalized = symbol.trim().toLowerCase();

  if (isGpwSymbol(normalized)) {
    const withoutSuffix = normalized.replace(/\.wa$/i, "");
    return uniqueBy([withoutSuffix, normalized], (item) => item);
  }

  return uniqueBy([normalized], (item) => item);
};

const parseStooqJsonQuote = async (response: Response) => {
  try {
    const payload = (await response.json()) as StooqQuoteResponse;
    const item = payload.symbols?.[0];
    const close = Number(item?.close);

    if (!Number.isFinite(close) || close <= 0) {
      return null;
    }

    return round(close);
  } catch {
    return null;
  }
};

const parseStooqCsvQuote = (csv: string) => {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const candidateLine =
    lines.length > 1 && /symbol/i.test(lines[0]) ? lines[1] : lines[0];
  const parts = candidateLine.split(",").map((part) => part.trim());
  const close = Number(parts[6] ?? parts[4] ?? parts[parts.length - 1]);

  return Number.isFinite(close) && close > 0 ? round(close) : null;
};

const fetchStooqPageQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode
): Promise<AssetQuote | null> => {
  const pageSymbols = getStooqPageSymbolCandidates(symbol);

  for (const pageSymbol of pageSymbols) {
    const response = await fetch(`${STOOQ_TEXT_PROXY_URL}${encodeURIComponent(pageSymbol)}`, {
      headers: {
        Accept: "text/plain",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      continue;
    }

    const markdown = await response.text();
    const priceMatch = markdown.match(/Kurs\s+\*\*([\d.,\s]+)\*\*/i);
    const price = priceMatch?.[1] ? parseStooqPageNumber(priceMatch[1]) : null;

    if (price === null) {
      continue;
    }

    const nameMatch = markdown.match(/Title:\s+.+?\s+-\s+(.+?)\s*$/m);

    return {
      symbol,
      price,
      marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
      provider: "stooq",
      fetchedAt: new Date().toISOString(),
      name: nameMatch?.[1]?.trim(),
    };
  }

  return null;
};

const fetchFinnhubProfile = async (symbol: string) => {
  if (!FINNHUB_API_KEY) return null;

  const response = await fetch(
    `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as FinnhubProfileResponse;

  if (!payload?.name && !payload?.country && !payload?.currency && !payload?.exchange) {
    return null;
  }

  return payload;
};

const searchFinnhub = async (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): Promise<AssetSearchResult[]> => {
  if (!FINNHUB_API_KEY) return [];

  const response = await fetch(
    `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return [];

  const payload: FinnhubSearchResponse = await response.json();
  const filteredResults = (payload.result ?? []).filter(
    (
      item
    ): item is {
      symbol: string;
      description?: string;
      displaySymbol?: string;
      type?: string;
    } => {
      if (!item.symbol) return false;
      if (kind === "stock" && !isStockLikeFinnhubType(item.type)) return false;
      if (kind === "etf" && !isEtfLikeFinnhubType(item.type)) return false;
      if (mode === "stock-gpw") return isGpwSymbol(item.symbol);
      if (mode === "stock-global") return isUsFinnhubSymbol(item.symbol);
      return true;
    }
  );

  const profiledResults =
    mode === "stock-global" && kind === "stock"
      ? await Promise.all(
          filteredResults.slice(0, 12).map(async (item) => ({
            item,
            profile: await fetchFinnhubProfile(item.symbol),
          }))
        )
      : filteredResults.map((item) => ({
          item,
          profile: null,
        }));

  return uniqueBy(
    profiledResults
      .filter(({ profile }) => {
        if (mode !== "stock-global" || kind !== "stock") return true;
        if (!profile) return false;
        return profile.country?.toUpperCase() === "US";
      })
      .map(({ item, profile }) => ({
        symbol: normalizeSymbol(item.symbol),
        name: profile?.name || item.description || item.displaySymbol || item.symbol,
        kind,
        marketCurrency:
          mode === "stock-gpw"
            ? "PLN"
            : toCurrencyCode(profile?.currency ?? inferCurrencyFromSymbol(item.symbol, "USD")),
        provider:
          mode === "stock-gpw"
            ? ("stooq" as const)
            : kind === "etf"
              ? getEtfProvider(item.symbol)
              : ("finnhub" as const),
      subtitle: "API",
      source: "api" as const,
    })),
    (item) => `${item.symbol}|${item.kind}|${item.provider}`
  )
    .slice(0, 8);
};

const searchCoinGecko = async (query: string): Promise<AssetSearchResult[]> => {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return [];

  const payload: CoinGeckoSearchResponse = await response.json();

  return (payload.coins ?? [])
    .filter((coin): coin is { id: string; name?: string; symbol?: string } => Boolean(coin.id))
    .slice(0, 8)
    .map((coin) => ({
      symbol: normalizeSymbol(coin.symbol || coin.id),
      name: coin.name || coin.id,
      kind: "crypto" as const,
      marketCurrency: "USD" as const,
      provider: "coingecko" as const,
      providerId: coin.id,
      subtitle: "CoinGecko",
      source: "api" as const,
    }));
};

const fetchCommoditySymbols = async () => {
  if (!COMMODITY_API_KEY) return [];

  const response = await fetch(
    `https://api.commoditypriceapi.com/v2/symbols?apiKey=${COMMODITY_API_KEY}`,
    {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 3600,
      },
    }
  );

  if (!response.ok) return [];

  const payload = (await response.json()) as CommoditySymbolPayload;
  const rawSymbols = payload.symbols;

  const items = Array.isArray(rawSymbols)
    ? rawSymbols
    : Object.values(rawSymbols ?? {});

  return items.filter(
    (
      item
    ): item is {
      symbol: string;
      category?: string;
      name?: string;
      status?: string;
      currency?: {
        code?: string;
      };
      unit?: {
        symbol?: string;
        name?: string;
      };
    } => Boolean(item.symbol) && item.status !== "deprecated"
  );
};

const searchCommodityApi = async (query: string): Promise<AssetSearchResult[]> => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const symbols = await fetchCommoditySymbols();

  return symbols
    .filter((item) => {
      const haystack = normalizeText(
        [
          item.symbol,
          item.name,
          item.category,
          item.unit?.symbol,
          item.unit?.name,
        ]
          .filter(Boolean)
          .join(" ")
      );

      return haystack.includes(normalizedQuery);
    })
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name ?? item.symbol,
      kind: "commodity" as const,
      marketCurrency: toCurrencyCode(item.currency?.code),
      provider: "commoditypriceapi" as const,
      subtitle: item.category,
      source: "api" as const,
    }));
};

const scoreCatalogMatch = (item: AssetCatalogItem, normalizedQuery: string) => {
  const symbol = normalizeText(item.symbol);
  const name = normalizeText(item.name);
  const subtitle = normalizeText(item.subtitle ?? "");
  const terms = item.searchTerms.map((term) => normalizeText(term));

  if (symbol === normalizedQuery) return 100;
  if (terms.some((term) => term === normalizedQuery)) return 95;
  if (name === normalizedQuery) return 90;
  if (symbol.startsWith(normalizedQuery)) return 80;
  if (terms.some((term) => term.startsWith(normalizedQuery))) return 75;
  if (name.startsWith(normalizedQuery)) return 70;
  if (symbol.includes(normalizedQuery)) return 60;
  if (terms.some((term) => term.includes(normalizedQuery))) return 55;
  if (name.includes(normalizedQuery)) return 50;
  if (subtitle.includes(normalizedQuery)) return 40;
  return 0;
};

const searchCatalogAssets = (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): AssetSearchResult[] => {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  const catalogItems =
    kind === "stock"
      ? LOCAL_STOCK_CATALOG
      : kind === "etf"
        ? LOCAL_ETF_CATALOG
        : [];

  return catalogItems
    .filter((item) => {
      if (item.kind !== kind) {
        return false;
      }

      if (mode === "stock-gpw" && !isGpwSymbol(item.symbol)) {
        return false;
      }

      if (mode === "stock-global" && isGpwSymbol(item.symbol)) {
        return false;
      }

      if (mode === "etf" && item.kind !== "etf") {
        return false;
      }

      return scoreCatalogMatch(item, normalizedQuery) > 0;
    })
    .sort(
      (left, right) =>
        scoreCatalogMatch(right, normalizedQuery) - scoreCatalogMatch(left, normalizedQuery)
    )
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name,
      kind: item.kind,
      marketCurrency: item.marketCurrency,
      provider: item.provider,
      providerId: item.providerId,
      subtitle: item.subtitle ?? "Katalog",
      source: "catalog" as const,
    }));
};

const fetchFinnhubQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode
): Promise<AssetQuote | null> => {
  if (!FINNHUB_API_KEY) return null;

  const [quoteResponse, profileResponse] = await Promise.all([
    fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`,
      { cache: "no-store" }
    ),
    fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`,
      { cache: "no-store" }
    ),
  ]);

  if (!quoteResponse.ok) return null;

  const quotePayload: FinnhubQuoteResponse = await quoteResponse.json();
  const profilePayload: FinnhubProfileResponse | null = profileResponse.ok
    ? await profileResponse.json()
    : null;

  if (typeof quotePayload.c !== "number" || quotePayload.c <= 0) {
    return null;
  }

  return {
    symbol,
    price: round(quotePayload.c),
    marketCurrency: toCurrencyCode(profilePayload?.currency ?? fallbackCurrency),
    provider: "finnhub",
    fetchedAt: new Date().toISOString(),
    name: profilePayload?.name,
  };
};

const fetchStooqQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode
): Promise<AssetQuote | null> => {
  const requestSymbols = getStooqSymbolCandidates(symbol);

  for (const requestSymbol of requestSymbols) {
    for (const domain of STOOQ_DOMAINS) {
      const liveResponse = await fetch(
        `${domain}/q/l/?s=${encodeURIComponent(requestSymbol)}&f=sd2t2ohlcv&h&e=json`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
          cache: "no-store",
        }
      );

      if (liveResponse.ok) {
        const close = await parseStooqJsonQuote(liveResponse);

        if (close !== null) {
          return {
            symbol,
            price: close,
            marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
            provider: "stooq",
            fetchedAt: new Date().toISOString(),
          };
        }
      }

      const csvLiveResponse = await fetch(
        `${domain}/q/l/?s=${encodeURIComponent(requestSymbol)}&f=sd2t2ohlcv&e=csv`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
          cache: "no-store",
        }
      );

      if (csvLiveResponse.ok) {
        const close = parseStooqCsvQuote(await csvLiveResponse.text());

        if (close !== null) {
          return {
            symbol,
            price: close,
            marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
            provider: "stooq",
            fetchedAt: new Date().toISOString(),
          };
        }
      }

      const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const response = await fetch(
        `${domain}/q/d/l/?s=${encodeURIComponent(requestSymbol)}&d1=20000101&d2=${today}&i=d`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
          cache: "no-store",
        }
      );

      if (!response.ok) {
        continue;
      }

      const csv = await response.text();
      const lines = csv
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        continue;
      }

      const lastLine = lines[lines.length - 1];
      const parts = lastLine.split(",");
      const close = Number(parts[4]);

      if (Number.isFinite(close) && close > 0) {
        return {
          symbol,
          price: round(close),
          marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
          provider: "stooq",
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  }

  return fetchStooqPageQuote(symbol, fallbackCurrency);
};

const fetchCoinGeckoQuote = async (
  symbol: string,
  providerId?: string
): Promise<AssetQuote | null> => {
  let coinId = providerId ?? "";

  if (!coinId) {
    const matches = await searchCoinGecko(symbol);
    coinId = matches[0]?.providerId ?? "";
  }

  if (!coinId) return null;

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      coinId
    )}&vs_currencies=usd`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as Record<
    string,
    {
      usd?: number;
    }
  >;
  const price = payload[coinId]?.usd;

  if (typeof price !== "number" || price <= 0) return null;

  return {
    symbol: normalizeSymbol(symbol),
    price: round(price),
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: coinId,
    fetchedAt: new Date().toISOString(),
  };
};

const COMMODITY_SYMBOL_MAP: Record<string, string> = {
  XAU: "XAU",
  XAG: "XAG",
  WTI: "WTIOIL-FUT",
  BRENT: "BRENTOIL-SPOT",
  NG: "NG-FUT",
};

const fetchCommodityQuote = async (symbol: string): Promise<AssetQuote | null> => {
  if (!COMMODITY_API_KEY) return null;

  const mappedSymbol = COMMODITY_SYMBOL_MAP[symbol] ?? symbol;
  const upstream = new URL("https://api.commoditypriceapi.com/v2/rates/latest");
  upstream.searchParams.set("apiKey", COMMODITY_API_KEY);
  upstream.searchParams.set("symbols", mappedSymbol);
  upstream.searchParams.set("quote", "USD");

  const response = await fetch(upstream.toString(), {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const payload = await response.json();
  const price = payload?.rates?.[mappedSymbol];

  if (typeof price !== "number" || price <= 0) return null;

  return {
    symbol,
    price: round(price),
    marketCurrency: "USD",
    provider: "commoditypriceapi",
    fetchedAt: new Date().toISOString(),
  };
};

export const searchMarketAssets = async (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): Promise<AssetSearchResult[]> => {
  if (!query.trim()) return [];

  if (kind === "crypto") {
    return searchCoinGecko(query);
  }

  if (kind === "commodity") {
    return searchCommodityApi(query);
  }

  if (kind === "stock" || kind === "etf") {
    const catalogResults = searchCatalogAssets(query, kind, mode);
    const remoteResults =
      mode === "stock-gpw" ? [] : await searchFinnhub(query, kind, mode);

    return uniqueBy(
      [...catalogResults, ...remoteResults],
      (item) => `${item.symbol}|${item.kind}|${item.provider}|${item.providerId ?? ""}`
    ).slice(0, 8);
  }

  return [];
};

export const fetchAssetQuoteServer = async ({
  symbol,
  kind,
  marketCurrency,
  provider,
  providerId,
}: {
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
}) => {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (kind === "crypto") {
    return fetchCoinGeckoQuote(normalizedSymbol, providerId);
  }

  if (kind === "commodity") {
    return fetchCommodityQuote(normalizedSymbol);
  }

  if (
    shouldUseStooqForGpwStock({
      symbol: normalizedSymbol,
      kind,
      marketCurrency,
      provider,
    })
  ) {
    return fetchStooqQuote(normalizedSymbol, "PLN");
  }

  if (provider === "finnhub") {
    return fetchFinnhubQuote(normalizedSymbol, marketCurrency);
  }

  if (provider === "stooq") {
    return fetchStooqQuote(normalizedSymbol, marketCurrency);
  }

  const autoQuote =
    (await fetchFinnhubQuote(normalizedSymbol, marketCurrency)) ??
    (await fetchStooqQuote(normalizedSymbol, marketCurrency));

  return autoQuote;
};

export const fetchFxRatesServer = async () => {
  const response = await fetch("https://api.nbp.pl/api/exchangerates/tables/A?format=json", {
    headers: {
      Accept: "application/json",
    },
    next: {
      revalidate: 300,
    },
  });

  if (!response.ok) {
    throw new Error("NBP request failed");
  }

  const payload = (await response.json()) as Array<{
    rates?: Array<{
      code?: string;
      mid?: number;
    }>;
  }>;

  const rates = payload[0]?.rates ?? [];

  return {
    PLN: 1,
    USD: rates.find((item) => item.code === "USD")?.mid ?? 1,
    EUR: rates.find((item) => item.code === "EUR")?.mid ?? 1,
  } as const;
};
