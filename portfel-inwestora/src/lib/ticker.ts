import { DEFAULT_DRAFT_BY_KIND } from "@/lib/constants";
import type {
  AssetDraft,
  AssetKind,
  CurrencyCode,
  QuoteProvider,
} from "@/types/portfolio";

export const normalizeSymbol = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, "");

export const getDefaultCurrencyForKind = (kind: AssetKind): CurrencyCode => {
  if (kind === "stock") return "PLN";
  return "USD";
};

export const getDefaultProviderForKind = (kind: AssetKind): QuoteProvider => {
  if (kind === "crypto") return "coingecko";
  if (kind === "commodity") return "commoditypriceapi";
  return "catalog";
};

export const createEmptyDraft = (kind: AssetKind = "stock"): AssetDraft =>
  DEFAULT_DRAFT_BY_KIND[kind];

export const createAssetId = () =>
  `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const inferCurrencyFromSymbol = (
  symbol: string,
  fallback: CurrencyCode = "USD"
): CurrencyCode => {
  if (/\.(WA)$/i.test(symbol)) return "PLN";
  if (/\.(DE|AS|DU|F|HM|MI|MU)$/i.test(symbol)) return "EUR";
  return fallback;
};
