import { normalizeSymbol } from "@/lib/ticker";
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

const TICKER_ALIASES: TickerAliasResolution[] = [
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

const tickerAliasesBySymbol = new Map(
  TICKER_ALIASES.map((alias) => [normalizeSymbol(alias.brokerSymbol), alias])
);

export const resolveTickerAlias = (
  symbol: string,
  kind?: AssetKind
): TickerAliasResolution | null => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const alias = tickerAliasesBySymbol.get(normalizedSymbol);

  if (!alias) {
    return null;
  }

  if (kind && alias.kind && alias.kind !== kind) {
    return null;
  }

  return alias;
};

export const getTickerAliasCandidates = (symbol: string, kind?: AssetKind) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const alias = resolveTickerAlias(normalizedSymbol, kind);

  return uniqueBy(
    [
      normalizedSymbol,
      alias?.symbol,
      alias?.providerId,
      alias?.isin,
    ].filter((candidate): candidate is string => Boolean(candidate)),
    (candidate) => normalizeSymbol(candidate)
  );
};

