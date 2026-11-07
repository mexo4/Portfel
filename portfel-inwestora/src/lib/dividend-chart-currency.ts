import { getIncomePresentationEquivalent } from "@/lib/income-currency";
import type { CurrencyCode, FxRates, PortfolioDividend } from "@/types/portfolio";

export type DividendChartAmountMode = "net" | "gross";

export type DividendChartCurrencyAmount = {
  amount: number;
  amountPln: number;
  hasReliablePlnAnchor: boolean;
};

export type DividendChartSourceBreakdown = Record<
  string,
  Record<string, Record<string, DividendChartCurrencyAmount>>
>;

export type DividendChartCurrencyLine = {
  sourceCurrency: CurrencyCode;
  amount: number;
  amountInPln: number;
  hasReliablePlnAnchor: boolean;
  presentationEquivalent: number | null;
};

/** Groups source-currency amounts by payment month and chart series without adding unlike currencies. */
export const buildDividendChartSourceBreakdown = (
  dividends: readonly PortfolioDividend[],
  amountMode: DividendChartAmountMode,
  getSeriesKey: (dividend: PortfolioDividend) => string,
): DividendChartSourceBreakdown => {
  const breakdown: DividendChartSourceBreakdown = {};

  dividends.forEach((dividend) => {
    const month = dividend.paymentDate.slice(0, 7);
    const seriesKey = getSeriesKey(dividend);
    const bySeries = breakdown[month] ?? (breakdown[month] = {});
    const byCurrency = bySeries[seriesKey] ?? (bySeries[seriesKey] = {});
    const existing = byCurrency[dividend.currency] ?? {
      amount: 0,
      amountPln: 0,
      hasReliablePlnAnchor: true,
    };

    existing.amount += amountMode === "net" ? dividend.netAmount : dividend.grossAmount;
    existing.amountPln += amountMode === "net" ? dividend.netAmountPln : dividend.grossAmountPln;
    existing.hasReliablePlnAnchor &&= dividend.hasReliablePlnAnchor;
    byCurrency[dividend.currency] = existing;
  });

  return breakdown;
};

/** Keeps the source amount first and exposes only a verified presentation-currency equivalent. */
export const getDividendChartCurrencyLines = (
  sourceAmounts: Record<string, DividendChartCurrencyAmount> | undefined,
  presentationCurrency: CurrencyCode,
  fxRates: FxRates,
  verifiedCurrencies: readonly CurrencyCode[],
): DividendChartCurrencyLine[] =>
  Object.entries(sourceAmounts ?? {}).map(([rawCurrency, source]) => {
    const sourceCurrency = rawCurrency as CurrencyCode;
    const presentationEquivalent = source.hasReliablePlnAnchor
      ? getIncomePresentationEquivalent({
          amount: source.amount,
          sourceCurrency,
          presentationCurrency,
          fxRates,
          amountInPln: source.amountPln,
          verifiedCurrencies,
        })
      : null;

    return {
      sourceCurrency,
      amount: source.amount,
      amountInPln: source.amountPln,
      hasReliablePlnAnchor: source.hasReliablePlnAnchor,
      presentationEquivalent,
    };
  }).sort((left, right) => left.sourceCurrency.localeCompare(right.sourceCurrency));
