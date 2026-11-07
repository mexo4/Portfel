import { getCurrencyConversionRate } from "@/lib/portfolio-engine";
import type { CurrencyCode, FxRates } from "@/types/portfolio";

const hasLiveRate = (currency: CurrencyCode, fxRates: FxRates) => {
  if (currency === "PLN") return true;
  const rate = fxRates[currency];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
};

/**
 * Returns a display-only equivalent for an income amount. Historical income may
 * provide an existing PLN anchor; upcoming estimates instead use the available
 * FX snapshot. Missing rates stay unavailable instead of becoming a guessed 0
 * or the portfolio engine's fallback rate.
 */
export const getIncomePresentationEquivalent = ({
  amount,
  sourceCurrency,
  presentationCurrency,
  fxRates,
  amountInPln,
  verifiedCurrencies,
}: {
  amount: number;
  sourceCurrency: CurrencyCode;
  presentationCurrency: CurrencyCode;
  fxRates: FxRates;
  amountInPln?: number;
  verifiedCurrencies: readonly CurrencyCode[];
}) => {
  if (!Number.isFinite(amount) || sourceCurrency === presentationCurrency) return null;

  if (amountInPln !== undefined) {
    if (!Number.isFinite(amountInPln) || !hasLiveRate(presentationCurrency, fxRates) || !verifiedCurrencies.includes(presentationCurrency)) return null;
    return amountInPln * getCurrencyConversionRate("PLN", presentationCurrency, fxRates);
  }

  if (
    !hasLiveRate(sourceCurrency, fxRates) ||
    !hasLiveRate(presentationCurrency, fxRates) ||
    !verifiedCurrencies.includes(sourceCurrency) ||
    !verifiedCurrencies.includes(presentationCurrency)
  ) return null;
  return amount * getCurrencyConversionRate(sourceCurrency, presentationCurrency, fxRates);
};
