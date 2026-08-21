import {
  buildDividendOperation,
  getDefaultDividendAccount,
  isDividendOperation,
} from "@/lib/dividend-engine";
import { getGpwTickerCore } from "@/lib/ticker";
import { round } from "@/lib/utils";
import type { CorporateEvent } from "@/lib/corporate-events";
import type {
  InvestmentPortfolio,
  PortfolioBook,
  PortfolioInstrument,
  PortfolioOperation,
} from "@/types/portfolio";

export const POLISH_DIVIDEND_TAX_RATE = 0.19;
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
    const eligibleQuantity = quantityDate
      ? portfolios.reduce((total, portfolio) => {
          const instrument = getPortfolioInstrumentForEvent(portfolio, event);
          return instrument
            ? total + getHistoricalInstrumentQuantity(portfolio, instrument.id, quantityDate)
            : total;
        }, 0)
      : undefined;

    if (eligibleQuantity === undefined) {
      return {
        ...event,
        eligibilityDate,
        eligibilityStatus,
      };
    }

    const estimatedGrossAmount = round(eligibleQuantity * event.dividendPerShare, 2);
    const estimatedTaxAmount = round(estimatedGrossAmount * POLISH_DIVIDEND_TAX_RATE, 2);
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

export type AutomaticDividendApplication = {
  portfolioBook: PortfolioBook;
  addedCount: number;
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
  let manualMatchesCount = 0;

  const portfolios = portfolioBook.portfolios.map((portfolio) => {
    let operations = portfolio.operations ?? [];
    let portfolioChanged = false;

    for (const event of events) {
      if (
        event.eventType !== "UPCOMING_DIVIDEND" ||
        event.status !== "CONFIRMED" ||
        !event.recordDate ||
        !event.paymentDate ||
        event.paymentDate > today ||
        !isFinitePositive(event.dividendPerShare) ||
        (event.dividendCurrency ?? "PLN") !== "PLN"
      ) {
        continue;
      }

      const instrument = getPortfolioInstrumentForEvent(portfolio, event);
      if (!instrument) continue;

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
      const domesticTax = round(grossAmount * POLISH_DIVIDEND_TAX_RATE, 2);
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
    portfolioBook: addedCount > 0 ? { ...portfolioBook, portfolios } : portfolioBook,
    addedCount,
    manualMatchesCount,
  };
};
