import type { ImportedBrokerOperation } from "@/lib/import-operations";
import type { CurrencyCode, FxRates, PortfolioOperation } from "@/types/portfolio";
import { round, toCurrencyCode } from "@/lib/utils";

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export type PreparedXtbImportOperation = ImportedBrokerOperation & {
  linkedCommissionAmount?: number;
  linkedCommissionImportKeys?: string[];
  linkedFeeImportKey?: string;
  importWarning?: string;
};

export const requireImportedHistoricalFxRate = (
  currency: CurrencyCode,
  historicalRates: FxRates,
  operation: Pick<ImportedBrokerOperation, "rowNumber" | "symbol" | "name" | "date">
) => {
  if (currency === "PLN") return 1;
  const rate = historicalRates[currency];
  if (positive(rate)) return rate;
  throw new Error(
    `Wiersz ${operation.rowNumber} (${operation.symbol || operation.name}, ${operation.date}): ` +
    `brak historycznego kursu ${currency}/PLN. Nie zapisano importu; nie użyto kursu bieżącego ani 1:1.`
  );
};

/** Rates passed here must come from the dated, historical-only FX endpoint.
 * The broker's quote-to-settlement ratio is not itself a rate to PLN. */
export const resolveImportedTradeValuation = (
  operation: PreparedXtbImportOperation,
  historicalRates: FxRates
) => {
  const marketCurrency = toCurrencyCode(operation.marketCurrency ?? operation.currency, "PLN");
  const cashCurrency = toCurrencyCode(
    operation.cashCurrency ?? operation.accountCurrency ?? operation.currency,
    "PLN"
  );
  const rateToPln = (currency: CurrencyCode) =>
    requireImportedHistoricalFxRate(currency, historicalRates, operation);
  const settlementFxRateToPln = rateToPln(cashCurrency);
  const marketAmount = positive(operation.marketAmount)
    ? operation.marketAmount
    : operation.quantity * operation.price * (operation.contractMultiplier ?? 1);
  const cashAmount = operation.cashAmount ?? operation.amount;
  // CFDs settle their result, rather than their underlying notional. Their
  // cash/result amount therefore cannot determine a quote conversion rate.
  const statementRatio = operation.instrumentType !== "CFD" &&
    positive(cashAmount) && positive(marketAmount)
    ? cashAmount / marketAmount
    : undefined;
  const quotedSettlementRate = positive(statementRatio)
    ? statementRatio
    : positive(operation.exchangeRate) && operation.instrumentType !== "CFD"
      ? operation.exchangeRate
      : undefined;
  const purchaseFxRateToPln = marketCurrency === cashCurrency
    ? settlementFxRateToPln
    : positive(quotedSettlementRate)
      ? quotedSettlementRate * settlementFxRateToPln
      : rateToPln(marketCurrency);
  const feePln = positive(operation.fee)
    ? operation.fee * settlementFxRateToPln
    : Math.abs(operation.feePln || 0);
  const financingPln = typeof operation.financing === "number" && Number.isFinite(operation.financing)
    ? Math.abs(operation.financing) * settlementFxRateToPln
    : 0;

  const linkedCommissionPln = positive(operation.linkedCommissionAmount)
    ? operation.linkedCommissionAmount * settlementFxRateToPln
    : 0;
  return {
    marketCurrency,
    cashCurrency,
    unitPrice: operation.price,
    priceCurrency: marketCurrency,
    purchaseFxRateToPln: round(purchaseFxRateToPln, 8),
    settlementFxRateToPln,
    totalFeePln: round(feePln + linkedCommissionPln + financingPln, 6),
  };
};

/** An incoming transfer belongs to the statement being imported. Its sender
 * is counterparty metadata and must never create a second imported account. */
export const getImportedStatementAccount = (operation: ImportedBrokerOperation) => ({
  accountNumber: operation.broker?.toUpperCase() === "XTB"
    ? operation.accountNumber
    : operation.sourceAccountNumber ?? operation.accountNumber,
  currency: toCurrencyCode(
    operation.broker?.toUpperCase() === "XTB"
      ? operation.accountCurrency ?? operation.cashCurrency ?? operation.currency
      : operation.sourceCurrency ?? operation.accountCurrency ?? operation.currency,
    "PLN"
  ),
});

const getImportedTimestamp = (operation: ImportedBrokerOperation) => {
  const time = operation.rawTime?.trim() ?? "";
  if (/^\d+(?:[.,]\d+)?$/.test(time)) {
    const serial = Number(time.replace(",", "."));
    if (serial >= 20_000 && serial <= 80_000) {
      return Math.round((serial - 25_569) * 86_400_000);
    }
  }
  const european = time.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (european) {
    return Date.UTC(
      Number(european[3]), Number(european[2]) - 1, Number(european[1]),
      Number(european[4]), Number(european[5]), Number(european[6] ?? 0)
    );
  }
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time) ? Date.parse(time) : NaN;
  return Number.isFinite(iso) ? iso : undefined;
};

/** XTB exports are often newest-first. Use source time before row position so
 * an afternoon disposal cannot precede the same morning's acquisition. */
export const compareImportedBrokerOperations = (
  left: ImportedBrokerOperation,
  right: ImportedBrokerOperation
) => {
  const dateOrder = left.date.localeCompare(right.date);
  if (dateOrder) return dateOrder;
  const leftTime = getImportedTimestamp(left);
  const rightTime = getImportedTimestamp(right);
  if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.rowNumber - right.rowNumber;
};

/** Separate statement fee rows already affect cash. Keep their investment
 * expense as an unallocated realized adjustment without guessing a trade. */
export const getImportedStandaloneExpense = (operation: PreparedXtbImportOperation) => {
  if (operation.operationType !== "FEE") return undefined;
  if (operation.linkedFeeImportKey) return undefined;
  if (operation.broker?.toUpperCase() !== "XTB" &&
    typeof operation.financing !== "number" && operation.rawType?.trim().toLowerCase() !== "swap") {
    return undefined;
  }
  return -Math.abs(operation.financing ?? operation.amount ?? operation.fee ?? 0);
};

const getImportIdentity = (operation: ImportedBrokerOperation) =>
  operation.importKey || (operation.brokerOperationId && operation.accountNumber
    ? `xtb:v2:${operation.accountNumber}:${operation.brokerOperationId}`
    : undefined);

/** Attribute a separate commission only when exact broker evidence identifies
 * one trade. Keep the FEE operation unchanged for the original cash ledger. */
export const prepareXtbImportOperations = (
  operations: ImportedBrokerOperation[],
  existingImportKeys = new Set<string>()
): PreparedXtbImportOperation[] => {
  const result: PreparedXtbImportOperation[] = operations.map((operation) => ({ ...operation }));
  result.forEach((operation) => {
    const consumed = new Set(operation.consumedSourceImportKeys ?? []);
    if (consumed.size === 0) return;
    const ownKeys = [getImportIdentity(operation), ...(operation.legacyImportKeys ?? [])]
      .filter((key): key is string => Boolean(key && !consumed.has(key)));
    if (!ownKeys.some((key) => existingImportKeys.has(key)) &&
      Array.from(consumed).some((key) => existingImportKeys.has(key))) {
      throw new Error(`Wiersz ${operation.rowNumber} (${operation.symbol}, ${operation.date}): ` +
        "część powiązanej operacji XTB jest już zapisana osobno. Wymagana jest kontrolowana korekta " +
        "wcześniejszego importu; nowy import nie został zapisany, aby nie zdublować podatku lub wyniku.");
    }
  });
  const wasImported = (operation: ImportedBrokerOperation) =>
    [getImportIdentity(operation), ...(operation.legacyImportKeys ?? [])]
      .some((key) => Boolean(key && existingImportKeys.has(key)));
  const matchingKey = (operation: ImportedBrokerOperation) => {
    const timestamp = getImportedTimestamp(operation);
    const symbol = (operation.rawSymbol || operation.symbol).trim().toUpperCase();
    if (!operation.accountNumber || !symbol || timestamp === undefined) return undefined;
    return [operation.accountNumber, getImportedStatementAccount(operation).currency,
      symbol, operation.date, timestamp].join("\u0000");
  };
  const trades = new Map<string, number[]>();
  result.forEach((operation, index) => {
    if (operation.broker?.toUpperCase() !== "XTB" ||
      !["BUY", "SELL"].includes(operation.operationType ?? "") || wasImported(operation)) return;
    const key = matchingKey(operation);
    if (key) {
      const candidates = trades.get(key) ?? [];
      const identity = getImportIdentity(operation);
      if (!identity || !candidates.some((candidate) => getImportIdentity(result[candidate]) === identity)) {
        trades.set(key, [...candidates, index]);
      }
    }
  });
  const attributedFeeIds = new Map<string, string>();
  result.forEach((fee) => {
    if (fee.broker?.toUpperCase() !== "XTB" || fee.operationType !== "FEE" ||
      !/^(commission|fee|fees)$/i.test(fee.rawType?.trim() ?? "") || wasImported(fee)) return;
    const key = matchingKey(fee);
    const candidates = key ? trades.get(key) ?? [] : [];
    const feeIdentity = getImportIdentity(fee);
    const previouslyAttributedTrade = feeIdentity && attributedFeeIds.get(feeIdentity);
    if (previouslyAttributedTrade) {
      fee.linkedFeeImportKey = previouslyAttributedTrade;
      return;
    }
    const trade = candidates.length === 1 ? result[candidates[0]] : undefined;
    const tradeIdentity = trade && getImportIdentity(trade);
    if (!trade || !tradeIdentity || !feeIdentity) {
      fee.importWarning = `Wiersz ${fee.rowNumber}: prowizję rozliczono jako osobny koszt ` +
        "zrealizowany; źródło nie pozwala jednoznacznie przypisać jej do transakcji.";
      return;
    }
    trade.linkedCommissionAmount = round((trade.linkedCommissionAmount ?? 0) +
      Math.abs(fee.amount ?? fee.fee ?? 0), 6);
    trade.linkedCommissionImportKeys = [...(trade.linkedCommissionImportKeys ?? []), feeIdentity];
    fee.linkedFeeImportKey = tradeIdentity;
    attributedFeeIds.set(feeIdentity, tradeIdentity);
  });
  return result;
};

export const getImportedCommissionMetadata = (operation: PreparedXtbImportOperation) => ({
  linkedCommissionAmount: operation.linkedCommissionAmount,
  linkedCommissionImportKeys: operation.linkedCommissionImportKeys,
  linkedFeeImportKey: operation.linkedFeeImportKey,
});

export const getStoredImportedOperationKeys = (operations: PortfolioOperation[]) => {
  const keys = new Set<string>();
  operations.forEach((operation) => {
    const metadata = operation.metadata;
    if (typeof metadata.importKey === "string" && metadata.importKey) keys.add(metadata.importKey);
    if (Array.isArray(metadata.legacyImportKeys)) {
      metadata.legacyImportKeys.forEach((key) => { if (typeof key === "string" && key) keys.add(key); });
    }
    if (metadata.importSource === "XTB" && metadata.accountNumber && metadata.brokerOperationId) {
      keys.add(`xtb:v2:${metadata.accountNumber}:${metadata.brokerOperationId}`);
    }
  });
  return keys;
};
