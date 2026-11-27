import {
  buildDividendOperation,
  getDefaultDividendAccount,
  isDividendOperation,
} from "@/lib/dividend-engine";
import { getGpwTickerCore } from "@/lib/ticker";
import { round } from "@/lib/utils";
import {
  calculatePolishDividendTax,
  getPortfolioAccountType,
} from "@/lib/portfolio-account-rules";
import type { CorporateEvent } from "@/lib/corporate-events";
import type {
  InvestmentPortfolio,
  PortfolioBook,
  PortfolioInstrument,
  PortfolioOperation,
} from "@/types/portfolio";

export const AUTOMATIC_DIVIDEND_NOTE = "Dodano automatycznie przez Mexo";

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isSameAmount = (left: number | null, right: number) =>
  typeof left === "number" && Math.abs(left - right) < 0.000001;

const getOperationPaymentDate = (operation: PortfolioOperation) =>
  typeof operation.metadata.paymentDate === "string"
    ? operation.metadata.paymentDate
    : operation.date;

const getPortfolioInstrumentForEvent = (
  portfolio: InvestmentPortfolio,
  event: Pick<CorporateEvent, "ticker">
): PortfolioInstrument | null =>
  portfolio.instruments?.find(
    (instrument) =>
      instrument.type === "STOCK" &&
      getGpwTickerCore(instrument.symbol) === getGpwTickerCore(event.ticker)
  ) ?? null;

/**
 * Replays the immutable trade ledger up to an entitlement date. Legacy lots
 * are already normalized to BUY/SELL operations by Portfolio Engine V2, so a
 * sale after the record date cannot reduce the quantity used for a dividend.
 */
export const getHistoricalInstrumentQuantity = (
  portfolio: InvestmentPortfolio,
  instrumentId: string,
  date: string
) => {
  const quantity = (portfolio.operations ?? []).reduce((total, operation) => {
    if (
      operation.assetId !== instrumentId ||
      operation.date > date ||
      !isFinitePositive(operation.quantity)
    ) {
      return total;
    }

    if (operation.operationType === "BUY") return total + operation.quantity;
    if (operation.operationType === "SELL") return total - operation.quantity;
    return total;
  }, 0);

  return Math.max(0, round(quantity, 8));
};

export const projectDividendEventsForPortfolios = ({
  events,
  portfolios,
  today,
}: {
  events: CorporateEvent[];
  portfolios: InvestmentPortfolio[];
  today: string;
}): CorporateEvent[] =>
  events.map((event) => {
    if (
      event.eventType !== "UPCOMING_DIVIDEND" ||
      !isFinitePositive(event.dividendPerShare)
    ) {
      return event;
    }

    const eligibilityDate = event.recordDate;
    const eligibilityStatus = !eligibilityDate
      ? "UNAVAILABLE" as const
      : eligibilityDate <= today
        ? "ENTITLEMENT_CONFIRMED" as const
        : "CURRENT_ESTIMATE" as const;
    const quantityDate = eligibilityStatus === "CURRENT_ESTIMATE" ? today : eligibilityDate;
    const portfolioEntitlements = quantityDate
      ? portfolios.flatMap((portfolio) => {
          const instrument = getPortfolioInstrumentForEvent(portfolio, event);
          if (!instrument) return [];
          const quantity = getHistoricalInstrumentQuantity(portfolio, instrument.id, quantityDate);
          return quantity > 0 ? [{ portfolio, quantity }] : [];
        })
      : undefined;
    const eligibleQuantity = portfolioEntitlements?.reduce(
      (total, entitlement) => total + entitlement.quantity,
      0
    );

    if (eligibleQuantity === undefined) {
      return {
        ...event,
        eligibilityDate,
        eligibilityStatus,
      };
    }

    const estimatedGrossAmount = round(eligibleQuantity * event.dividendPerShare, 2);
    const estimatedTaxAmount = round(
      (portfolioEntitlements ?? []).reduce((total, entitlement) => {
        const grossAmount = entitlement.quantity * event.dividendPerShare!;
        return total + calculatePolishDividendTax({
          grossAmount,
          accountType: getPortfolioAccountType(entitlement.portfolio),
          paymentDate: event.paymentDate ?? event.eventDate,
        }).amount;
      }, 0),
      2
    );
    const estimatedNetAmount = round(estimatedGrossAmount - estimatedTaxAmount, 2);

    return {
      ...event,
      heldQuantity: round(eligibleQuantity, 8),
      eligibleQuantity: round(eligibleQuantity, 8),
      eligibilityDate,
      eligibilityStatus,
      estimatedGrossAmount,
      estimatedTaxAmount,
      estimatedNetAmount,
    };
  });

const operationMatchesDividendEvent = ({
  operation,
  portfolio,
  event,
}: {
  operation: PortfolioOperation;
  portfolio: InvestmentPortfolio;
  event: CorporateEvent;
}) => {
  if (!isDividendOperation(operation) || !operation.assetId) return false;
  if (operation.metadata.automaticDividendEventId === event.id) return true;

  const instrument = portfolio.instruments?.find((candidate) => candidate.id === operation.assetId);
  return Boolean(
    instrument &&
    getGpwTickerCore(instrument.symbol) === getGpwTickerCore(event.ticker) &&
    getOperationPaymentDate(operation) === event.paymentDate &&
    event.dividendPerShare !== undefined &&
    isSameAmount(operation.price, event.dividendPerShare) &&
    operation.currency === (event.dividendCurrency ?? "PLN")
  );
};

/** A payment before the record day cannot happen: such a date was misread from the notice. */
const hasImpossibleDates = (recordDate: unknown, paymentDate: unknown) =>
  typeof recordDate === "string" && typeof paymentDate === "string" &&
  recordDate !== "" && paymentDate !== "" && paymentDate < recordDate;

const MAX_RECORD_DATE_SHIFT_DAYS = 60;

const daysApart = (left: string, right: string) =>
  Math.abs(Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) / 86_400_000;

/**
 * An automatic entry with impossible dates that the corrected event describes: the same company
 * and amount per share, with a record day close to the corrected one. Editing an entry drops its
 * automatic mark, so entries the user has touched are never matched.
 */
const isMisdatedPostingOfEvent = ({
  operation,
  instrumentId,
  event,
}: {
  operation: PortfolioOperation;
  instrumentId: string;
  event: CorporateEvent;
}) =>
  operation.metadata.automaticDividend === true &&
  operation.assetId === instrumentId &&
  hasImpossibleDates(operation.metadata.recordDate, getOperationPaymentDate(operation)) &&
  isSameAmount(operation.price, event.dividendPerShare!) &&
  daysApart(String(operation.metadata.recordDate), event.recordDate!) <= MAX_RECORD_DATE_SHIFT_DAYS;

/**
 * Entries booked before the fix stored the booking day as the ex-dividend day when the notice
 * gave none. A day after the payment is certainly that placeholder.
 */
const withoutPlaceholderExDate = (operation: PortfolioOperation) => {
  const exDividendDate = operation.metadata.exDividendDate;
  if (
    operation.metadata.automaticDividend !== true ||
    typeof exDividendDate !== "string" ||
    exDividendDate <= getOperationPaymentDate(operation)
  ) {
    return operation;
  }
  const metadata = { ...operation.metadata };
  delete metadata.exDividendDate;
  return { ...operation, metadata };
};

export type AutomaticDividendApplication = {
  portfolioBook: PortfolioBook;
  addedCount: number;
  /** Automatic entries with wrong dates that were removed or tidied. */
  repairedCount: number;
  manualMatchesCount: number;
};

/**
 * Pure, deterministic posting step. Only a confirmed GPW dividend with a
 * published record date and payment date can become a historical operation.
 */
export const applyAutomaticGpwDividends = ({
  portfolioBook,
  events,
  today,
  createdAt = new Date().toISOString(),
}: {
  portfolioBook: PortfolioBook;
  events: CorporateEvent[];
  today: string;
  createdAt?: string;
}): AutomaticDividendApplication => {
  let addedCount = 0;
  let repairedCount = 0;
  let manualMatchesCount = 0;

  const portfolios = portfolioBook.portfolios.map((portfolio) => {
    let operations = (portfolio.operations ?? []).map((operation) => withoutPlaceholderExDate(operation));
    const tidied = operations.filter((operation, index) => operation !== portfolio.operations![index]).length;
    let portfolioChanged = tidied > 0;
    repairedCount += tidied;

    for (const event of events) {
      if (
        event.eventType !== "UPCOMING_DIVIDEND" ||
        event.status !== "CONFIRMED" ||
        !event.recordDate ||
        !event.paymentDate ||
        hasImpossibleDates(event.recordDate, event.paymentDate) ||
        !isFinitePositive(event.dividendPerShare) ||
        (event.dividendCurrency ?? "PLN") !== "PLN"
      ) {
        continue;
      }

      const instrument = getPortfolioInstrumentForEvent(portfolio, event);
      if (!instrument) continue;

      // Now that the dates read correctly, the entry booked with impossible ones goes. It is
      // booked again below, on the right day, once that day has come.
      const kept = operations.filter((operation) => !isMisdatedPostingOfEvent({ operation, instrumentId: instrument.id, event }));
      if (kept.length < operations.length) {
        repairedCount += operations.length - kept.length;
        operations = kept;
        portfolioChanged = true;
      }
      if (event.paymentDate > today) continue;

      const matchingOperation = operations.find((operation) =>
        operationMatchesDividendEvent({ operation, portfolio, event })
      );
      if (matchingOperation) {
        if (matchingOperation.metadata.automaticDividend !== true) {
          manualMatchesCount += 1;
        }
        continue;
      }

      const quantity = getHistoricalInstrumentQuantity(
        portfolio,
        instrument.id,
        event.recordDate
      );
      if (quantity <= 0) continue;

      const account = getDefaultDividendAccount(portfolio.accounts ?? []);
      if (!account) continue;

      const grossAmount = round(quantity * event.dividendPerShare, 2);
      const taxTreatment = calculatePolishDividendTax({
        grossAmount,
        accountType: getPortfolioAccountType(portfolio),
        paymentDate: event.paymentDate,
      });
      const domesticTax = taxTreatment.amount;
      const operation = buildDividendOperation({
        id: `auto-dividend:${portfolio.id}:${event.id}`,
        portfolioId: portfolio.id,
        accountId: account.id,
        instrumentId: instrument.id,
        quantity,
        dividendPerShare: event.dividendPerShare,
        currency: "PLN",
        exchangeRate: 1,
        withholdingTax: 0,
        domesticTax,
        exDividendDate: event.exDividendDate ?? "",
        recordDate: event.recordDate,
        paymentDate: event.paymentDate,
        country: "PL",
        notes: AUTOMATIC_DIVIDEND_NOTE,
        metadata: {
          automaticDividend: true,
          automaticDividendEventId: event.id,
          automaticDividendSourceUrl: event.source?.sourceUrl,
          automaticDividendInstallment: event.dividendInstallment,
          automaticDividendPostedAt: createdAt,
          accountTypeAtPosting: getPortfolioAccountType(portfolio),
          domesticTaxTreatment: taxTreatment.treatment,
          domesticTaxRuleNote: taxTreatment.note,
        },
        createdAt,
      });

      operations = [...operations, operation];
      portfolioChanged = true;
      addedCount += 1;
    }

    return portfolioChanged ? { ...portfolio, operations, updatedAt: createdAt } : portfolio;
  });

  return {
    portfolioBook: addedCount + repairedCount > 0 ? { ...portfolioBook, portfolios } : portfolioBook,
    addedCount,
    repairedCount,
    manualMatchesCount,
  };
};
