import { DEFAULT_DRAFT_BY_KIND } from "@/lib/constants";
import type {
  AssetDraft,
  AssetKind,
  CurrencyCode,
  PortfolioAsset,
  QuoteProvider,
} from "@/types/portfolio";

export const normalizeSymbol = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, "");

const GPW_SUFFIX_PATTERN = /\.(WA|PL)$/i;

export const isGpwSymbol = (value: string) => GPW_SUFFIX_PATTERN.test(normalizeSymbol(value));

export const getGpwTickerCore = (value: string) =>
  normalizeSymbol(value).replace(GPW_SUFFIX_PATTERN, "");

export const normalizeGpwSymbol = (value: string) => {
  const normalized = normalizeSymbol(value);

  if (!normalized) {
    return "";
  }

  if (isGpwSymbol(normalized)) {
    return normalized;
  }

  return `${normalized}.WA`;
};

export const getGpwSymbolKey = (value: string) => {
  const normalized = normalizeSymbol(value);

  if (!normalized) {
    return "";
  }

  return isGpwSymbol(normalized) ? getGpwTickerCore(normalized) : normalized;
};

export const toStooqGpwSymbol = (value: string) => {
  const tickerCore = getGpwTickerCore(value);
  return tickerCore ? `${tickerCore}.WA` : "";
};

export const getPortfolioAssetGroupKey = (
  asset: Pick<PortfolioAsset, "kind" | "symbol">
) => {
  const normalizedSymbol = normalizeSymbol(asset.symbol);

  if (asset.kind === "stock" && isGpwSymbol(normalizedSymbol)) {
    return `${asset.kind}:${getGpwTickerCore(normalizedSymbol)}`;
  }

  return `${asset.kind}:${normalizedSymbol}`;
};

export const getDefaultCurrencyForKind = (kind: AssetKind): CurrencyCode => {
  if (kind === "stock" || kind === "bond") return "PLN";
  return "USD";
};

export const getDefaultProviderForKind = (kind: AssetKind): QuoteProvider => {
  if (kind === "bond") return "obligacjeskarbowe";
  if (kind === "crypto") return "coingecko";
  if (kind === "etf") return "eodhd";
  return "catalog";
};

export const createEmptyDraft = (kind: AssetKind = "stock"): AssetDraft =>
  DEFAULT_DRAFT_BY_KIND[kind];

export const createAssetId = () =>
  `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MARKET_SUFFIX_CURRENCY: Record<string, CurrencyCode> = {
  AS: "EUR",
  BO: "INR",
  BE: "EUR",
  BD: "BDT",
  DE: "EUR",
  DU: "EUR",
  F: "EUR",
  HE: "EUR",
  HM: "EUR",
  IR: "EUR",
  HK: "HKD",
  L: "GBP",
  LS: "EUR",
  MC: "EUR",
  MI: "EUR",
  MU: "EUR",
  MX: "MXN",
  NS: "INR",
  PA: "EUR",
  STU: "EUR",
  SW: "CHF",
  TO: "CAD",
  V: "CAD",
  T: "JPY",
};

export const inferCurrencyFromSymbol = (
  symbol: string,
  fallback: CurrencyCode = "USD"
): CurrencyCode => {
  if (isGpwSymbol(symbol)) return "PLN";

  const normalizedSymbol = normalizeSymbol(symbol);
  const suffix = normalizedSymbol.includes(".")
    ? normalizedSymbol.split(".").at(-1)
    : undefined;

  if (suffix && MARKET_SUFFIX_CURRENCY[suffix]) {
    return MARKET_SUFFIX_CURRENCY[suffix];
  }

  return fallback;
};
