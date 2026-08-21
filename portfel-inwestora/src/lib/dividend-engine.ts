import { BASE_CURRENCY } from "@/lib/constants";
import { convertToPln } from "@/lib/portfolio-engine";
import { round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type {
  DividendCalendarBucket,
  DividendCalendarGroup,
  DividendForecast,
  DividendReportBucket,
  DividendReportRow,
  FxRates,
  InvestmentPortfolio,
  PortfolioAccount,
  PortfolioDividend,
  PortfolioInstrument,
  PortfolioOperation,
} from "@/types/portfolio";

const DIVIDEND_METADATA_KIND = "dividend";

const hasFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getMetadataString = (
  metadata: Record<string, unknown>,
  key: string,
  fallback = ""
) => (typeof metadata[key] === "string" ? metadata[key] : fallback);

const getMetadataNumber = (
  metadata: Record<string, unknown>,
  key: string,
  fallback = 0
) => (hasFiniteNumber(metadata[key]) ? metadata[key] : fallback);

const getDateMonthKey = (date: string) => date.slice(0, 7);

const getDateYearKey = (date: string) => date.slice(0, 4);

const getDateQuarterKey = (date: string) => {
  const month = Number(date.slice(5, 7));
  const quarter = Number.isFinite(month) && month > 0 ? Math.ceil(month / 3) : 1;

  return `${getDateYearKey(date)} Q${quarter}`;
};

const getDaysBetween = (leftDate: string, rightDate: string) => {
  const left = new Date(`${leftDate}T00:00:00.000Z`).getTime();
  const right = new Date(`${rightDate}T00:00:00.000Z`).getTime();

  return Math.round((right - left) / 86_400_000);
};

export const isDividendOperation = (operation: PortfolioOperation) =>
  operation.operationType === "DIVIDEND" ||
  operation.metadata.kind === DIVIDEND_METADATA_KIND;

export const buildDividendOperation = ({
  id,
  portfolioId,
  accountId,
  instrumentId,
  quantity,
  dividendPerShare,
  currency,
  exchangeRate,
  withholdingTax,
  domesticTax,
  exDividendDate,
  recordDate,
  paymentDate,
  country,
  notes,
  metadata,
  createdAt,
}: {
  id: string;
  portfolioId: string;
  accountId: string;
  instrumentId: string;
  quantity: number;
  dividendPerShare: number;
  currency: string;
  exchangeRate: number | null;
  withholdingTax: number;
  domesticTax: number;
  exDividendDate: string;
  recordDate: string;
  paymentDate: string;
  country: string;
  notes: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): PortfolioOperation => {
  const now = createdAt ?? new Date().toISOString();
  const normalizedCurrency = toCurrencyCode(currency, BASE_CURRENCY);
  const grossAmount = round(quantity * dividendPerShare, 6);
  const totalTax = round(withholdingTax + domesticTax, 6);
  const netAmount = round(grossAmount - totalTax, 6);

  return {
    id,
    portfolioId,
    accountId,
    assetId: instrumentId,
    operationType: "DIVIDEND",
    quantity: round(quantity, 6),
    price: round(dividendPerShare, 6),
    currency: normalizedCurrency,
    exchangeRate,
    fee: 0,
    tax: totalTax,
    amount: netAmount,
    date: toDateInputValue(paymentDate),
    notes: notes.trim(),
    metadata: {
      ...metadata,
      kind: DIVIDEND_METADATA_KIND,
      grossAmount,
      withholdingTax: round(withholdingTax, 6),
      domesticTax: round(domesticTax, 6),
      netAmount,
      exDividendDate: toDateInputValue(exDividendDate),
      recordDate: toDateInputValue(recordDate),
      paymentDate: toDateInputValue(paymentDate),
      country: country.trim(),
    },
    createdAt: now,
    updatedAt: now,
  };
};

export const operationToDividend = ({
  operation,
  portfolio,
  fxRates,
}: {
  operation: PortfolioOperation;
  portfolio: InvestmentPortfolio;
  fxRates: FxRates;
}): PortfolioDividend | null => {
  if (!isDividendOperation(operation) || !operation.assetId) {
    return null;
  }

  const instrument = portfolio.instruments?.find((item) => item.id === operation.assetId);
  const account = portfolio.accounts?.find((item) => item.id === operation.accountId);

  if (!instrument) {
    return null;
  }

  const quantity = operation.quantity ?? getMetadataNumber(operation.metadata, "quantity");
  const dividendPerShare =
    operation.price ?? getMetadataNumber(operation.metadata, "dividendPerShare");
  const grossAmount =
    getMetadataNumber(operation.metadata, "grossAmount") ||
    round(quantity * dividendPerShare, 6);
  const withholdingTax = getMetadataNumber(operation.metadata, "withholdingTax");
  const domesticTax = getMetadataNumber(operation.metadata, "domesticTax");
  const netAmount =
    getMetadataNumber(operation.metadata, "netAmount") ||
    round(grossAmount - withholdingTax - domesticTax, 6);
  const currency = toCurrencyCode(operation.currency, instrument.marketCurrency);
  const fxRate =
    operation.exchangeRate ??
    (currency === BASE_CURRENCY ? 1 : fxRates[currency] ?? null);
  const grossAmountPln =
    fxRate && fxRate > 0 ? round(grossAmount * fxRate) : convertToPln(grossAmount, currency, fxRates);
  const netAmountPln =
    fxRate && fxRate > 0 ? round(netAmount * fxRate) : convertToPln(netAmount, currency, fxRates);

  return {
    id: operation.id,
    portfolioId: portfolio.id,
    accountId: operation.accountId,
    accountName: account?.name ?? "Konto inwestycyjne",
    instrumentId: instrument.id,
    instrumentName: instrument.name,
    symbol: instrument.symbol,
    quantity: round(quantity, 6),
    dividendPerShare: round(dividendPerShare, 6),
    grossAmount: round(grossAmount, 6),
    withholdingTax: round(withholdingTax, 6),
    domesticTax: round(domesticTax, 6),
    netAmount: round(netAmount, 6),
    currency,
    exchangeRate: fxRate,
    grossAmountPln,
    netAmountPln,
    exDividendDate: getMetadataString(operation.metadata, "exDividendDate", operation.date),
    recordDate: getMetadataString(operation.metadata, "recordDate", operation.date),
    paymentDate: getMetadataString(operation.metadata, "paymentDate", operation.date),
    country: getMetadataString(operation.metadata, "country", "Nie ustawiono"),
    notes: operation.notes,
    isAutomatic: operation.metadata.automaticDividend === true,
    corporateEventId: getMetadataString(operation.metadata, "automaticDividendEventId") || undefined,
    sourceUrl: getMetadataString(operation.metadata, "automaticDividendSourceUrl") || undefined,
    operationId: operation.id,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
};

export const getPortfolioDividends = (
  portfolio: InvestmentPortfolio,
  fxRates: FxRates
) =>
  (portfolio.operations ?? [])
    .map((operation) => operationToDividend({ operation, portfolio, fxRates }))
    .filter((dividend): dividend is PortfolioDividend => Boolean(dividend))
    .sort(
      (left, right) =>
        right.paymentDate.localeCompare(left.paymentDate) ||
        right.createdAt.localeCompare(left.createdAt)
    );

const getDividendReportKey = (
  dividend: PortfolioDividend,
  bucket: DividendReportBucket
) => {
  if (bucket === "monthly") return getDateMonthKey(dividend.paymentDate);
  if (bucket === "quarterly") return getDateQuarterKey(dividend.paymentDate);
  if (bucket === "yearly") return getDateYearKey(dividend.paymentDate);
  if (bucket === "company") return dividend.symbol;
  if (bucket === "portfolio") return dividend.portfolioId;
  if (bucket === "currency") return dividend.currency;
  return dividend.country || "Nie ustawiono";
};

const getDividendReportLabel = (
  dividend: PortfolioDividend,
  bucket: DividendReportBucket
) => {
  if (bucket === "company") return `${dividend.symbol} - ${dividend.instrumentName}`;
  if (bucket === "portfolio") return dividend.portfolioId;
  return getDividendReportKey(dividend, bucket);
};

export const buildDividendReport = (
  dividends: PortfolioDividend[],
  bucket: DividendReportBucket
): DividendReportRow[] => {
  const rowsByKey = new Map<string, DividendReportRow>();

  dividends.forEach((dividend) => {
    const key = getDividendReportKey(dividend, bucket);
    const row = rowsByKey.get(key) ?? {
      key,
      label: getDividendReportLabel(dividend, bucket),
      grossAmountPln: 0,
      netAmountPln: 0,
      taxPln: 0,
      paymentsCount: 0,
    };

    rowsByKey.set(key, {
      ...row,
      grossAmountPln: round(row.grossAmountPln + dividend.grossAmountPln),
      netAmountPln: round(row.netAmountPln + dividend.netAmountPln),
      taxPln: round(
        row.taxPln + dividend.grossAmountPln - dividend.netAmountPln
      ),
      paymentsCount: row.paymentsCount + 1,
    });
  });

  return Array.from(rowsByKey.values()).sort((left, right) =>
    right.key.localeCompare(left.key)
  );
};

const createCalendarGroup = (
  bucket: DividendCalendarBucket,
  label: string,
  dividends: PortfolioDividend[]
): DividendCalendarGroup => ({
  bucket,
  label,
  dividends,
  grossAmountPln: round(
    dividends.reduce((total, dividend) => total + dividend.grossAmountPln, 0)
  ),
  netAmountPln: round(
    dividends.reduce((total, dividend) => total + dividend.netAmountPln, 0)
  ),
});

export const buildDividendCalendar = (
  dividends: PortfolioDividend[],
  today = new Date().toISOString().slice(0, 10)
) => {
  const todayDate = today;

  return [
    createCalendarGroup(
      "today",
      "Dzis",
      dividends.filter((dividend) => dividend.paymentDate === todayDate)
    ),
    createCalendarGroup(
      "week",
      "Ten tydzien",
      dividends.filter((dividend) => {
        const days = getDaysBetween(todayDate, dividend.paymentDate);
        return days >= 0 && days <= 7;
      })
    ),
    createCalendarGroup(
      "month",
      "Ten miesiac",
      dividends.filter(
        (dividend) =>
          dividend.paymentDate >= todayDate &&
          dividend.paymentDate.slice(0, 7) === todayDate.slice(0, 7)
      )
    ),
    createCalendarGroup(
      "upcoming",
      "Przyszle wyplaty",
      dividends.filter((dividend) => dividend.paymentDate > todayDate)
    ),
    createCalendarGroup(
      "history",
      "Historia",
      dividends.filter((dividend) => dividend.paymentDate < todayDate)
    ),
  ];
};

export const buildDividendForecast = (
  dividends: PortfolioDividend[],
  today = new Date().toISOString().slice(0, 10)
): DividendForecast => {
  const historicalDividends = dividends.filter(
    (dividend) => dividend.paymentDate <= today
  );
  const upcomingDividends = dividends
    .filter((dividend) => dividend.paymentDate > today)
    .sort((left, right) => left.paymentDate.localeCompare(right.paymentDate));

  if (historicalDividends.length === 0) {
    return {
      monthlyIncomePln: 0,
      annualIncomePln: 0,
      nextPayment: upcomingDividends[0] ?? null,
      message: "Brakuje historii dywidend do wyliczenia prognozy.",
    };
  }

  const trailingYearStart = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const trailingYearDividends = historicalDividends.filter(
    (dividend) => dividend.paymentDate >= trailingYearStart
  );
  const forecastSource =
    trailingYearDividends.length > 0 ? trailingYearDividends : historicalDividends;
  const annualIncomePln = round(
    forecastSource.reduce((total, dividend) => total + dividend.netAmountPln, 0)
  );

  return {
    monthlyIncomePln: round(annualIncomePln / 12),
    annualIncomePln,
    nextPayment: upcomingDividends[0] ?? null,
    message: null,
  };
};

export const getDefaultDividendInstrument = (
  portfolio: InvestmentPortfolio
): PortfolioInstrument | null => {
  const openAsset = portfolio.assets[0];

  if (!openAsset) {
    return portfolio.instruments?.[0] ?? null;
  }

  return (
    portfolio.instruments?.find((instrument) =>
      instrument.metadata.legacyGroupKey ===
      `${openAsset.kind}:${openAsset.symbol.toUpperCase()}`
    ) ??
    portfolio.instruments?.find((instrument) => instrument.symbol === openAsset.symbol) ??
    null
  );
};

export const getDefaultDividendAccount = (
  accounts: PortfolioAccount[] = []
) =>
  accounts.find((account) => account.kind === "investment" && account.isDefault) ??
  accounts.find((account) => account.kind === "investment") ??
  accounts[0] ??
  null;
