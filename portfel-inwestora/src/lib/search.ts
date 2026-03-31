import { KIND_LABELS, SEARCH_MODE_OPTIONS } from "@/lib/constants";
import { inferCurrencyFromSymbol } from "@/lib/ticker";
import { uniqueBy } from "@/lib/utils";
import type {
  AssetKind,
  AssetSearchMode,
  AssetSearchResult,
} from "@/types/portfolio";

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
  if (mode === "crypto") return "Np. bitcoin, solana, BTC";
  return "Np. gold, silver, oil";
};

export const getKindLabel = (kind: AssetKind) => KIND_LABELS[kind];

export const getModeConfig = (mode: AssetSearchMode) =>
  SEARCH_MODE_OPTIONS.find((option) => option.value === mode) ?? SEARCH_MODE_OPTIONS[0];

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
    candidates.push({
      symbol: normalized,
      name: normalized,
      kind: "stock",
      marketCurrency: "PLN",
      provider: "stooq",
      subtitle: "Ticker GPW / Stooq",
      source: "fallback",
    });

    if (!normalized.endsWith(".WA")) {
      candidates.push({
        symbol: `${normalized}.WA`,
        name: normalized,
        kind: "stock",
        marketCurrency: "PLN",
        provider: "stooq",
        subtitle: "Ticker GPW / Stooq",
        source: "fallback",
      });
    }
  }

  if (mode === "stock-global") {
    return candidates;
  }

  if (kind === "etf" || mode === "etf") {
    const isEuropeanEtf = /\.(AS|DE|DU|F|HM|MI|MU)$/i.test(normalized);

    candidates.push({
      symbol: normalized,
      name: normalized,
      kind: "etf",
      marketCurrency: inferCurrencyFromSymbol(normalized, "USD"),
      provider: isEuropeanEtf ? "stooq" : "finnhub",
      subtitle: "Ticker wpisany recznie",
      source: "fallback",
    });
  }

  return candidates;
};

export const mergeSearchResults = (items: AssetSearchResult[]) =>
  uniqueBy(items, (item) => `${item.symbol}|${item.providerId ?? ""}|${item.kind}`).slice(0, 8);
