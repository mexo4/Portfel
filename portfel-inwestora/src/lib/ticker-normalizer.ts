import {
  isGpwSymbol,
  normalizeGpwSymbol,
  normalizeSymbol,
} from "@/lib/ticker";
import { uniqueBy } from "@/lib/utils";
import type { AssetKind, CurrencyCode, QuoteProvider } from "@/types/portfolio";

export type TickerAliasResolution = {
  brokerSymbol: string;
  symbol: string;
  kind?: AssetKind;
  marketCurrency?: CurrencyCode;
  provider?: QuoteProvider;
  providerId?: string;
  name?: string;
  priceScale?: number;
  isin?: string;
};

export type TickerLookupCandidate = {
  value: string;
  source: "broker" | "normalized" | "alias" | "provider" | "isin" | "name";
};

export type TickerIdentity = {
  originalSymbol: string;
  normalizedSymbol: string;
  symbol: string;
  kind?: AssetKind;
  marketCurrency?: CurrencyCode;
  provider?: QuoteProvider;
  providerId?: string;
  name?: string;
  priceScale?: number;
  isin?: string;
  alias?: TickerAliasResolution;
};

type NormalizeTickerOptions = {
  kind?: AssetKind;
  marketCurrency?: CurrencyCode;
};

type ResolveTickerOptions = NormalizeTickerOptions & {
  symbol: string;
};

type TickerLookupOptions = ResolveTickerOptions & {
  providerId?: string;
  isin?: string;
  name?: string;
  includeName?: boolean;
};

export const TICKER_ALIAS_MAP: readonly TickerAliasResolution[] = [
  {
    brokerSymbol: "NOVOB.DK",
    symbol: "NOVO-B.CO",
    kind: "stock",
    marketCurrency: "DKK",
    provider: "yahoo",
    providerId: "NOVO-B.CO",
    name: "Novo Nordisk A/S",
  },
  {
    brokerSymbol: "CCC.PL",
    symbol: "MDV.WA",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    name: "Modivo",
    isin: "PLCCC0000016",
  },
  {
    brokerSymbol: "ETFBDIVPL.PL",
    symbol: "ETFBDIVPL.WA",
    kind: "etf",
    marketCurrency: "PLN",
    provider: "yahoo",
    providerId: "ETFBDIVPL.WA",
    name: "Beta ETF Dywidenda Plus",
    isin: "PLBTFDP00015",
  },
  {
    brokerSymbol: "ISAC.UK",
    symbol: "ISAC.L",
    kind: "etf",
    marketCurrency: "GBP",
    provider: "yahoo",
    providerId: "ISAC.L",
    name: "iShares MSCI ACWI UCITS ETF USD Acc",
    priceScale: 0.01,
  },
  {
    brokerSymbol: "ISLN.UK",
    symbol: "ISLN.L",
    kind: "etf",
    marketCurrency: "GBP",
    provider: "yahoo",
    providerId: "ISLN.L",
    name: "iShares Physical Silver ETC",
    priceScale: 0.01,
  },
];

const TRADING_CURRENCY_SUFFIX_PATTERN =
  /[-/](USD|USDT|EUR|PLN|GBP|CHF|DKK|CZK|CAD|JPY|NOK|SEK)$/i;

const BROKER_SUFFIX_RULES: Array<{
  suffix: string;
  normalizedCurrency: CurrencyCode;
  kinds: AssetKind[];
}> = [
  {
    suffix: ".US",
    normalizedCurrency: "USD",
    kinds: ["stock", "etf"],
  },
];

const tickerAliasesByLookupKey = new Map<string, TickerAliasResolution>();

TICKER_ALIAS_MAP.forEach((alias) => {
  [
    alias.brokerSymbol,
    alias.symbol,
    alias.providerId,
    alias.isin,
  ].forEach((candidate) => {
    const key = normalizeSymbol(candidate ?? "");

    if (key && !tickerAliasesByLookupKey.has(key)) {
      tickerAliasesByLookupKey.set(key, alias);
    }
  });
});

const isRuleApplicable = (
  rule: (typeof BROKER_SUFFIX_RULES)[number],
  options: NormalizeTickerOptions
) => {
  if (options.kind && !rule.kinds.includes(options.kind)) {
    return false;
  }

  return !options.marketCurrency || options.marketCurrency === rule.normalizedCurrency;
};

export const normalizeBrokerTicker = (
  symbol: string,
  options: NormalizeTickerOptions = {}
) => {
  const normalized = normalizeSymbol(symbol).replace(TRADING_CURRENCY_SUFFIX_PATTERN, "");

  if (!normalized) {
    return "";
  }

  if (options.kind === "crypto") {
    return normalized;
  }

  const suffixRule = BROKER_SUFFIX_RULES.find(
    (rule) => normalized.endsWith(rule.suffix) && isRuleApplicable(rule, options)
  );

  if (suffixRule) {
    return normalized.slice(0, -suffixRule.suffix.length);
  }

  if (
    options.kind === "stock" &&
    options.marketCurrency === "PLN" &&
    !normalized.includes(".")
  ) {
    return normalizeGpwSymbol(normalized);
  }

  return normalized;
};

export const resolveTickerAlias = (
  symbol: string,
  kind?: AssetKind
): TickerAliasResolution | null => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedBrokerSymbol = normalizeBrokerTicker(normalizedSymbol, { kind });
  const lookupKeys = uniqueBy(
    [normalizedSymbol, normalizedBrokerSymbol].filter(Boolean),
    (candidate) => candidate
  );

  for (const lookupKey of lookupKeys) {
    const alias = tickerAliasesByLookupKey.get(lookupKey);

    if (!alias) {
      continue;
    }

    if (kind && alias.kind && alias.kind !== kind) {
      continue;
    }

    return alias;
  }

  return null;
};

export const resolveTickerIdentity = ({
  symbol,
  kind,
  marketCurrency,
}: ResolveTickerOptions): TickerIdentity => {
  const originalSymbol = normalizeSymbol(symbol);
  const normalizedSymbol = normalizeBrokerTicker(originalSymbol, { kind, marketCurrency });
  const alias = resolveTickerAlias(originalSymbol, kind) ?? resolveTickerAlias(normalizedSymbol, kind);
  const resolvedSymbol = normalizeSymbol(alias?.symbol ?? normalizedSymbol ?? originalSymbol);

  return {
    originalSymbol,
    normalizedSymbol,
    symbol: resolvedSymbol,
    kind: alias?.kind ?? kind,
    marketCurrency: alias?.marketCurrency ?? marketCurrency,
    provider: alias?.provider,
    providerId: alias?.providerId,
    name: alias?.name,
    priceScale: alias?.priceScale,
    isin: alias?.isin,
    alias: alias ?? undefined,
  };
};

export const getTickerLookupCandidates = ({
  symbol,
  kind,
  marketCurrency,
  providerId,
  isin,
  name,
  includeName = false,
}: TickerLookupOptions): TickerLookupCandidate[] => {
  const identity = resolveTickerIdentity({ symbol, kind, marketCurrency });
  const alias = identity.alias;

  return uniqueBy(
    [
      { value: identity.originalSymbol, source: "broker" as const },
      { value: identity.normalizedSymbol, source: "normalized" as const },
      { value: alias?.symbol ?? "", source: "alias" as const },
      { value: alias?.providerId ?? "", source: "alias" as const },
      { value: providerId ?? "", source: "provider" as const },
      { value: alias?.isin ?? "", source: "isin" as const },
      { value: isin ?? "", source: "isin" as const },
      { value: includeName ? alias?.name ?? "" : "", source: "name" as const },
      { value: includeName ? name ?? "" : "", source: "name" as const },
    ].filter((candidate) => candidate.value.trim()),
    (candidate) => normalizeSymbol(candidate.value)
  );
};

export const getTickerAliasCandidates = (symbol: string, kind?: AssetKind) =>
  getTickerLookupCandidates({ symbol, kind }).map((candidate) => candidate.value);

export const getCanonicalPortfolioSymbol = (
  symbol: string,
  options: NormalizeTickerOptions = {}
) => resolveTickerIdentity({ symbol, ...options }).symbol;

export const isGpwTickerCandidate = (symbol: string) =>
  isGpwSymbol(symbol) || normalizeBrokerTicker(symbol, { kind: "stock", marketCurrency: "PLN" }).endsWith(".WA");
