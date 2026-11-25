import { buildCashOperation } from "@/lib/cash-engine";
import { addMonths } from "@/lib/wealth-instruments";
import type { CurrencyCode, InvestmentPortfolio, PortfolioOperation } from "@/types/portfolio";

/**
 * Recurring cash operations (a monthly deposit, a yearly account fee...). The definitions live in
 * the portfolio's metadata. Nothing is booked behind the user's back: due dates are listed, and
 * the user books them with one click. Each booked occurrence carries its key, so a date is never
 * booked twice, also after editing or reloading.
 */

export const RECURRING_METADATA_KEY = "recurringOperations";
export const RECURRING_TYPES = ["DEPOSIT", "WITHDRAW", "FEE", "INTEREST"] as const;
export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
const MAX_OCCURRENCES_PER_DEFINITION = 240;

export type RecurringOperationType = (typeof RECURRING_TYPES)[number];
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export type RecurringOperation = {
  id: string;
  operationType: RecurringOperationType;
  amount: number;
  currency: CurrencyCode;
  accountId: string;
  frequency: RecurringFrequency;
  startDate: string;
  endDate: string | null;
  notes: string;
  createdAt: string;
};

export type RecurringOccurrence = { definition: RecurringOperation; date: string; key: string };

export const RECURRING_TYPE_LABELS: Record<RecurringOperationType, string> = { DEPOSIT: "Wpłata", WITHDRAW: "Wypłata", FEE: "Opłata", INTEREST: "Odsetki" };
export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = { weekly: "co tydzień", monthly: "co miesiąc", quarterly: "co kwartał", yearly: "co rok" };

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The definitions saved with a portfolio; anything malformed is skipped. */
export const readRecurringOperations = (portfolio: Pick<InvestmentPortfolio, "metadata">): RecurringOperation[] => {
  const raw = portfolio.metadata?.[RECURRING_METADATA_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): RecurringOperation[] => {
    const record = (item ?? {}) as Record<string, unknown>;
    const amount = Number(record.amount);
    if (
      typeof record.id !== "string" || !record.id ||
      !RECURRING_TYPES.includes(record.operationType as RecurringOperationType) ||
      !RECURRING_FREQUENCIES.includes(record.frequency as RecurringFrequency) ||
      !Number.isFinite(amount) || amount <= 0 ||
      typeof record.accountId !== "string" || !record.accountId ||
      !isDate(record.startDate)
    ) return [];
    return [{
      id: record.id,
      operationType: record.operationType as RecurringOperationType,
      amount: Math.round(amount * 100) / 100,
      currency: typeof record.currency === "string" && record.currency ? record.currency : "PLN",
      accountId: record.accountId,
      frequency: record.frequency as RecurringFrequency,
      startDate: record.startDate,
      endDate: isDate(record.endDate) && record.endDate >= record.startDate ? record.endDate : null,
      notes: typeof record.notes === "string" ? record.notes.slice(0, 200) : "",
      createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    }];
  });
};

export const withRecurringOperations = (portfolio: InvestmentPortfolio, definitions: RecurringOperation[]): InvestmentPortfolio => ({
  ...portfolio,
  metadata: { ...(portfolio.metadata ?? {}), [RECURRING_METADATA_KEY]: definitions },
  updatedAt: new Date().toISOString(),
});

const occurrenceDate = (definition: RecurringOperation, index: number) => {
  if (definition.frequency === "weekly") {
    const date = new Date(`${definition.startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 7 * index);
    return date.toISOString().slice(0, 10);
  }
  // Counted from the start date every time, so 31 January stays the end of each month.
  const months = definition.frequency === "monthly" ? 1 : definition.frequency === "quarterly" ? 3 : 12;
  return addMonths(definition.startDate, months * index);
};

/** Dates of a definition from its start up to `until` (and its end date). */
export const getOccurrenceDates = (definition: RecurringOperation, until: string) => {
  const dates: string[] = [];
  for (let index = 0; index < MAX_OCCURRENCES_PER_DEFINITION; index += 1) {
    const date = occurrenceDate(definition, index);
    if (date > until || (definition.endDate && date > definition.endDate)) break;
    dates.push(date);
  }
  return dates;
};

export const getNextOccurrence = (definition: RecurringOperation, today: string) => {
  for (let index = 0; index < MAX_OCCURRENCES_PER_DEFINITION * 4; index += 1) {
    const date = occurrenceDate(definition, index);
    if (definition.endDate && date > definition.endDate) return null;
    if (date > today) return date;
  }
  return null;
};

export const occurrenceKey = (definitionId: string, date: string) => `${definitionId}:${date}`;

/** Dates up to today that have no booked operation yet, oldest first. */
export const getDueRecurringOccurrences = (portfolio: InvestmentPortfolio, today: string): RecurringOccurrence[] => {
  const booked = new Set(
    (portfolio.operations ?? [])
      .map((operation) => operation.metadata?.recurringOccurrenceKey)
      .filter((key): key is string => typeof key === "string")
  );
  return readRecurringOperations(portfolio)
    .flatMap((definition) => getOccurrenceDates(definition, today).map((date) => ({ definition, date, key: occurrenceKey(definition.id, date) })))
    .filter((occurrence) => !booked.has(occurrence.key))
    .sort((left, right) => left.date.localeCompare(right.date) || left.definition.id.localeCompare(right.definition.id));
};

/** The portfolio with the occurrences booked as ordinary cash operations. */
export const bookRecurringOccurrences = (
  portfolio: InvestmentPortfolio,
  occurrences: RecurringOccurrence[],
  createId: () => string
): InvestmentPortfolio => {
  const accounts = new Set((portfolio.accounts ?? []).map((account) => account.id));
  const operations: PortfolioOperation[] = occurrences
    .filter((occurrence) => accounts.has(occurrence.definition.accountId))
    .map((occurrence) => {
      const operation = buildCashOperation({
        id: createId(),
        portfolioId: portfolio.id,
        accountId: occurrence.definition.accountId,
        operationType: occurrence.definition.operationType,
        amount: occurrence.definition.amount,
        currency: occurrence.definition.currency,
        date: occurrence.date,
        notes: occurrence.definition.notes || `Operacja cykliczna: ${RECURRING_TYPE_LABELS[occurrence.definition.operationType].toLowerCase()} ${RECURRING_FREQUENCY_LABELS[occurrence.definition.frequency]}`,
      });
      return { ...operation, metadata: { ...operation.metadata, recurringOperationId: occurrence.definition.id, recurringOccurrenceKey: occurrence.key } };
    });
  return { ...portfolio, operations: [...(portfolio.operations ?? []), ...operations], updatedAt: new Date().toISOString() };
};
