import type { CurrencyCode, InvestmentPortfolio, PortfolioDividend, PortfolioSale } from "@/types/portfolio";
import { round } from "@/lib/utils";

/**
 * A helper summary for the Polish PIT-38 return, from the data recorded in Mexo. It is not tax
 * advice and does not replace the PIT-8C a Polish broker issues.
 *
 * Method (art. 11a and art. 30b of the PIT act):
 * - An amount in a foreign currency is converted at the NBP average rate of the last business
 *   day before the day of the transaction (sale: the sale date, cost: the purchase date of each
 *   closed lot, dividend: the payment date).
 * - Shares and ETFs (part C): revenue is the sale value, costs are the purchase value of the lots
 *   closed by first-in first-out plus the buy and sell fees.
 * - CFDs and short positions (part C): a positive result of a close is revenue, a negative one a
 *   cost, and fees are costs.
 * - Foreign dividends (part G): 19% of the gross amount, less the tax withheld abroad up to 19%
 *   of the gross amount and the Polish tax a broker already withheld.
 * - Left out on purpose: IKE, IKZE and OKI portfolios (tax-free wrappers), treasury bonds (the
 *   tax is withheld at redemption), cryptocurrencies (a separate part with its own rules) and
 *   results imported without their purchase data (shown, not counted).
 */

export const PIT38_TAX_RATE = 0.19;

/** NBP rate of the last business day strictly before `date`, or null when it is not known. */
export type NbpRateBefore = (currency: CurrencyCode, date: string) => { rate: number; rateDate: string } | null;

export type ConvertedAmount = {
  amount: number;
  currency: CurrencyCode;
  rate: number;
  /** Date of the NBP table used; equal to the transaction date's previous business day. */
  rateDate: string | null;
  amountPln: number;
};

export type Pit38SecurityTransaction = {
  id: string;
  portfolioName: string;
  name: string;
  symbol: string;
  saleDate: string;
  quantity: number;
  treatment: "shares" | "derivative";
  revenuePln: number;
  costPln: number;
  incomePln: number;
  revenue: ConvertedAmount | null;
  purchases: Array<ConvertedAmount & { purchaseDate: string; quantity: number }>;
  feesPln: number;
  missingRates: Array<{ currency: CurrencyCode; date: string }>;
};

export type Pit38DividendRow = {
  id: string;
  portfolioName: string;
  name: string;
  symbol: string;
  paymentDate: string;
  country: string;
  currency: CurrencyCode;
  gross: ConvertedAmount | null;
  withheldAbroadPln: number;
  domesticTaxPln: number;
  polishTaxPln: number;
  creditablePln: number;
  toPayPln: number;
  missingRate: boolean;
};

export type Pit38Report = {
  year: number;
  securities: {
    /** PIT-38 part C, revenue (przychód). */
    revenuePln: number;
    /** PIT-38 part C, costs (koszty uzyskania przychodów). */
    costPln: number;
    incomePln: number;
    lossPln: number;
    /** Income rounded to whole złoty: below 50 gr down, from 50 gr up. */
    taxBasePln: number;
    /** 19% of the tax base, rounded to whole złoty. */
    taxPln: number;
    transactions: Pit38SecurityTransaction[];
  };
  foreignDividends: {
    grossPln: number;
    polishTaxPln: number;
    creditablePln: number;
    domesticTaxPln: number;
    /** Tax to pay for foreign dividends, rounded to whole złoty. */
    toPayPln: number;
    rows: Pit38DividendRow[];
  };
  excluded: {
    taxFreePortfolios: string[];
    bondTrades: number;
    cryptoTrades: number;
    importedResults: Array<{ portfolioName: string; date: string; amountPln: number; note: string }>;
  };
  missingRates: Array<{ currency: CurrencyCode; date: string }>;
};

const TAX_FREE_ACCOUNT_TYPES = new Set(["IKE", "IKZE", "OKI"]);

/** Polish tax rounding of a base or a tax: below 50 gr down, from 50 gr up (art. 63 Ordynacji). */
export const roundToWholeZloty = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(round(value, 2));
  return sign * Math.floor(absolute + 0.5);
};

const isTaxFreePortfolio = (portfolio: InvestmentPortfolio) => TAX_FREE_ACCOUNT_TYPES.has(portfolio.accountType ?? "STANDARD");

const convert = (amount: number, currency: CurrencyCode, date: string, rateBefore: NbpRateBefore): ConvertedAmount | null => {
  if (currency === "PLN") return { amount: round(amount, 6), currency, rate: 1, rateDate: null, amountPln: round(amount, 2) };
  const found = rateBefore(currency, date);
  if (!found) return null;
  return { amount: round(amount, 6), currency, rate: found.rate, rateDate: found.rateDate, amountPln: round(amount * found.rate, 2) };
};

const isDerivative = (sale: PortfolioSale) => sale.instrumentType === "CFD" || sale.positionDirection === "SHORT";

const securityTransaction = (
  portfolio: InvestmentPortfolio,
  sale: PortfolioSale,
  rateBefore: NbpRateBefore
): Pit38SecurityTransaction => {
  const multiplier = sale.contractMultiplier && sale.contractMultiplier > 0 ? sale.contractMultiplier : 1;
  const saleCurrency = sale.marketCurrency || "PLN";
  const missingRates: Array<{ currency: CurrencyCode; date: string }> = [];
  const buyFeesPln = (sale.allocations ?? []).reduce((total, allocation) => total + (allocation.allocatedBuyFeePln ?? 0), 0);
  const feesPln = round(buyFeesPln + (sale.feePln ?? 0), 2);

  // A derivative's result is converted at the rate before the close; its opening prices need no rate.
  const purchases = (isDerivative(sale) ? [] : sale.allocations ?? []).map((allocation) => {
    const currency = allocation.purchasePriceCurrency ?? allocation.purchaseCurrency ?? saleCurrency;
    const lotMultiplier = allocation.contractMultiplier && allocation.contractMultiplier > 0 ? allocation.contractMultiplier : multiplier;
    const converted = convert(allocation.purchasePrice * allocation.quantity * lotMultiplier, currency, allocation.purchaseDate, rateBefore);
    if (!converted) missingRates.push({ currency, date: allocation.purchaseDate });
    return converted ? { ...converted, purchaseDate: allocation.purchaseDate, quantity: allocation.quantity } : null;
  });

  const base = {
    id: sale.id,
    portfolioName: portfolio.name,
    name: sale.name,
    symbol: sale.symbol,
    saleDate: sale.saleDate,
    quantity: sale.quantity,
    feesPln,
    purchases: purchases.filter((purchase): purchase is NonNullable<typeof purchase> => Boolean(purchase)),
  };

  if (isDerivative(sale)) {
    // Result of the close in the instrument's currency, converted at the rate before the close.
    const resultInCurrency = (sale.allocations ?? []).reduce((total, allocation) => {
      const lotMultiplier = allocation.contractMultiplier && allocation.contractMultiplier > 0 ? allocation.contractMultiplier : multiplier;
      const perUnit = sale.positionDirection === "SHORT" ? allocation.purchasePrice - sale.salePrice : sale.salePrice - allocation.purchasePrice;
      return total + perUnit * allocation.quantity * lotMultiplier;
    }, 0);
    const result = convert(resultInCurrency, saleCurrency, sale.saleDate, rateBefore);
    if (!result) missingRates.push({ currency: saleCurrency, date: sale.saleDate });
    const resultPln = result?.amountPln ?? 0;
    const revenuePln = round(Math.max(0, resultPln), 2);
    const costPln = round(Math.max(0, -resultPln) + feesPln, 2);
    return { ...base, treatment: "derivative", revenue: result, revenuePln, costPln, incomePln: round(revenuePln - costPln, 2), missingRates };
  }

  const revenue = convert(sale.salePrice * sale.quantity * multiplier, saleCurrency, sale.saleDate, rateBefore);
  if (!revenue) missingRates.push({ currency: saleCurrency, date: sale.saleDate });
  const revenuePln = revenue?.amountPln ?? 0;
  const costPln = round(base.purchases.reduce((total, purchase) => total + purchase.amountPln, 0) + feesPln, 2);
  return { ...base, treatment: "shares", revenue, revenuePln, costPln, incomePln: round(revenuePln - costPln, 2), missingRates };
};

const isForeignDividend = (dividend: PortfolioDividend) => {
  const country = (dividend.country ?? "").trim().toUpperCase();
  if (country && country !== "PL" && country !== "POLSKA" && country !== "POLAND") return true;
  return !country && (dividend.currency ?? "PLN") !== "PLN";
};

const dividendRow = (portfolio: InvestmentPortfolio, dividend: PortfolioDividend, rateBefore: NbpRateBefore): Pit38DividendRow => {
  const currency = dividend.currency || "PLN";
  const gross = convert(dividend.grossAmount, currency, dividend.paymentDate, rateBefore);
  const rate = gross?.rate ?? 0;
  // Withholding and domestic tax are recorded in the dividend's currency.
  const withheldAbroadPln = gross ? round(dividend.withholdingTax * rate, 2) : 0;
  const domesticTaxPln = gross ? round(dividend.domesticTax * rate, 2) : 0;
  const grossPln = gross?.amountPln ?? 0;
  const polishTaxPln = round(grossPln * PIT38_TAX_RATE, 2);
  const creditablePln = round(Math.min(withheldAbroadPln, polishTaxPln), 2);
  const toPayPln = round(Math.max(0, polishTaxPln - creditablePln - domesticTaxPln), 2);

  return {
    id: dividend.id,
    portfolioName: portfolio.name,
    name: dividend.instrumentName,
    symbol: dividend.symbol,
    paymentDate: dividend.paymentDate,
    country: dividend.country,
    currency,
    gross,
    withheldAbroadPln,
    domesticTaxPln,
    polishTaxPln,
    creditablePln,
    toPayPln,
    missingRate: !gross,
  };
};

export const buildPit38Report = ({
  portfolios,
  dividendsByPortfolio,
  year,
  rateBefore,
}: {
  portfolios: InvestmentPortfolio[];
  /** Dividends of each portfolio (see `getPortfolioDividends`), keyed by portfolio id. */
  dividendsByPortfolio: Map<string, PortfolioDividend[]>;
  year: number;
  rateBefore: NbpRateBefore;
}): Pit38Report => {
  const inYear = (date: string) => date?.startsWith(`${year}-`);
  const taxFree = portfolios.filter(isTaxFreePortfolio);
  const taxable = portfolios.filter((portfolio) => !isTaxFreePortfolio(portfolio));
  let bondTrades = 0;
  let cryptoTrades = 0;
  const transactions: Pit38SecurityTransaction[] = [];

  for (const portfolio of taxable) {
    for (const sale of portfolio.sales ?? []) {
      if (!inYear(sale.saleDate)) continue;
      if (sale.kind === "bond" || sale.transactionKind !== "sale") {
        bondTrades += 1;
        continue;
      }
      if (sale.kind === "crypto") {
        cryptoTrades += 1;
        continue;
      }
      transactions.push(securityTransaction(portfolio, sale, rateBefore));
    }
  }
  transactions.sort((left, right) => left.saleDate.localeCompare(right.saleDate) || left.name.localeCompare(right.name, "pl"));

  const revenuePln = round(transactions.reduce((total, transaction) => total + transaction.revenuePln, 0), 2);
  const costPln = round(transactions.reduce((total, transaction) => total + transaction.costPln, 0), 2);
  const net = round(revenuePln - costPln, 2);
  const taxBasePln = net > 0 ? roundToWholeZloty(net) : 0;

  const rows = taxable
    .flatMap((portfolio) =>
      (dividendsByPortfolio.get(portfolio.id) ?? [])
        .filter((dividend) => inYear(dividend.paymentDate) && isForeignDividend(dividend))
        .map((dividend) => dividendRow(portfolio, dividend, rateBefore))
    )
    .sort((left, right) => left.paymentDate.localeCompare(right.paymentDate));
  const dividendTaxBeforeRounding = rows.reduce((total, row) => total + row.toPayPln, 0);

  const importedResults = taxable.flatMap((portfolio) =>
    (portfolio.realizedAdjustments ?? [])
      .filter((adjustment) => adjustment.source === "broker-import" && inYear(adjustment.date))
      .map((adjustment) => ({ portfolioName: portfolio.name, date: adjustment.date, amountPln: round(adjustment.amountPlnSnapshot), note: adjustment.note ?? "" }))
  );

  const missing = new Map<string, { currency: CurrencyCode; date: string }>();
  for (const transaction of transactions) for (const item of transaction.missingRates) missing.set(`${item.currency}:${item.date}`, item);
  for (const row of rows) if (row.missingRate) missing.set(`${row.currency}:${row.paymentDate}`, { currency: row.currency, date: row.paymentDate });

  return {
    year,
    securities: {
      revenuePln,
      costPln,
      incomePln: Math.max(0, net),
      lossPln: Math.max(0, round(-net, 2)),
      taxBasePln,
      taxPln: roundToWholeZloty(taxBasePln * PIT38_TAX_RATE),
      transactions,
    },
    foreignDividends: {
      grossPln: round(rows.reduce((total, row) => total + (row.gross?.amountPln ?? 0), 0), 2),
      polishTaxPln: round(rows.reduce((total, row) => total + row.polishTaxPln, 0), 2),
      creditablePln: round(rows.reduce((total, row) => total + row.creditablePln, 0), 2),
      domesticTaxPln: round(rows.reduce((total, row) => total + row.domesticTaxPln, 0), 2),
      toPayPln: roundToWholeZloty(dividendTaxBeforeRounding),
      rows,
    },
    excluded: {
      taxFreePortfolios: taxFree.map((portfolio) => portfolio.name),
      bondTrades,
      cryptoTrades,
      importedResults,
    },
    missingRates: [...missing.values()].sort((left, right) => left.date.localeCompare(right.date)),
  };
};

/** Every currency and date for which the report needs an NBP rate (to fetch them in one go). */
export const collectPit38RateNeeds = (portfolios: InvestmentPortfolio[], dividendsByPortfolio: Map<string, PortfolioDividend[]>, year: number) => {
  const needs = new Map<CurrencyCode, Set<string>>();
  const add = (currency: CurrencyCode | undefined, date: string | undefined) => {
    if (!currency || currency === "PLN" || !date) return;
    needs.set(currency, (needs.get(currency) ?? new Set()).add(date.slice(0, 10)));
  };
  for (const portfolio of portfolios.filter((item) => !isTaxFreePortfolio(item))) {
    for (const sale of portfolio.sales ?? []) {
      if (!sale.saleDate?.startsWith(`${year}-`) || sale.kind === "bond" || sale.kind === "crypto" || sale.transactionKind !== "sale") continue;
      add(sale.marketCurrency, sale.saleDate);
      if (isDerivative(sale)) continue;
      for (const allocation of sale.allocations ?? []) add(allocation.purchasePriceCurrency ?? allocation.purchaseCurrency ?? sale.marketCurrency, allocation.purchaseDate);
    }
    for (const dividend of dividendsByPortfolio.get(portfolio.id) ?? []) {
      if (dividend.paymentDate?.startsWith(`${year}-`) && isForeignDividend(dividend)) add(dividend.currency, dividend.paymentDate);
    }
  }
  return needs;
};

/** Builds the lookup from NBP points (date ascending): the last point strictly before the date. */
export const createRateBefore = (pointsByCurrency: Map<CurrencyCode, Array<{ date: string; rate: number }>>): NbpRateBefore => (currency, date) => {
  const points = pointsByCurrency.get(currency);
  if (!points?.length) return null;
  let low = 0;
  let high = points.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].date < date.slice(0, 10)) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found < 0) return null;
  const point = points[found];
  // A rate older than ten days means the series has a gap, not a long weekend.
  const ageDays = (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${point.date}T00:00:00Z`)) / 86_400_000;
  return point.rate > 0 && ageDays <= 10 ? { rate: point.rate, rateDate: point.date } : null;
};
