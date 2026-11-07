import { getIncomePresentationEquivalent } from "@/lib/income-currency";
import { formatCurrency } from "@/lib/utils";
import type { CurrencyCode, FxRates } from "@/types/portfolio";

type Props = {
  amount: number;
  sourceCurrency: CurrencyCode;
  presentationCurrency: CurrencyCode;
  fxRates: FxRates;
  verifiedCurrencies: readonly CurrencyCode[];
  amountInPln?: number;
  suffix?: string;
  className?: string;
};

export default function IncomeCurrencyAmount({
  amount,
  sourceCurrency,
  presentationCurrency,
  fxRates,
  verifiedCurrencies,
  amountInPln,
  suffix,
  className = "",
}: Props) {
  const equivalent = getIncomePresentationEquivalent({
    amount,
    sourceCurrency,
    presentationCurrency,
    fxRates,
    amountInPln,
    verifiedCurrencies,
  });
  const hasDifferentCurrency = sourceCurrency !== presentationCurrency;

  return (
    <span className={`income-currency-pair ${className}`.trim()}>
      <strong className="income-currency-primary">
        {formatCurrency(amount, sourceCurrency)}{suffix ? ` ${suffix}` : ""}
      </strong>
      {hasDifferentCurrency ? (
        equivalent !== null ? (
          <small className="income-currency-secondary">
            {formatCurrency(equivalent, presentationCurrency)} · w {presentationCurrency}
          </small>
        ) : (
          <small className="income-currency-unavailable">
            Brak kursu {sourceCurrency}/{presentationCurrency}
          </small>
        )
      ) : null}
    </span>
  );
}
