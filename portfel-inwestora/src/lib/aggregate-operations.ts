import type {
  InvestmentPortfolio,
  OperationType,
  PortfolioOperation,
  PortfolioRealizedAdjustment,
  PortfolioSale,
} from "@/types/portfolio";

export type AggregateOperationPortfolio = Pick<
  InvestmentPortfolio,
  | "id"
  | "name"
  | "operations"
  | "accounts"
  | "instruments"
  | "assets"
  | "sales"
  | "realizedAdjustments"
  | "accountType"
>;

export type AggregateOperationResult = {
  amount: number;
  currency: string;
};

export type AggregateOperationRow = {
  key: string;
  portfolioId: string;
  portfolioName: string;
  operation: PortfolioOperation;
  instrumentName: string | null;
  instrumentSymbol: string | null;
  instrumentType: string | null;
  accountName: string | null;
  targetAccountName: string | null;
  result: AggregateOperationResult | null;
  resultPln: number | null;
  sale: PortfolioSale | null;
  realizedAdjustment: PortfolioRealizedAdjustment | null;
  isSyntheticAdjustment: boolean;
};

export type AggregateOperationFilters = {
  query?: string;
  portfolioId?: string;
  operationType?: string;
  instrument?: string;
  currency?: string;
  account?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type AggregateOperationSortMode =
  | "created-desc"
  | "date-desc"
  | "date-asc"
  | "result-desc"
  | "result-asc"
  | "symbol-asc";

export function getPolishOperationCountLabel(count: number) {
  const absoluteCount = Math.abs(Math.trunc(count));
  const lastTwoDigits = absoluteCount % 100;
  const lastDigit = absoluteCount % 10;
  if (absoluteCount === 1) return "operacja";
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return "operacje";
  }
  return "operacji";
}

const getMetadataString = (operation: PortfolioOperation, key: string) => {
  const value = operation.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const getMetadataNumber = (operation: PortfolioOperation, key: string) => {
  const value = operation.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const getLegacySource = (operation: PortfolioOperation) =>
  getMetadataString(operation, "legacySource");

const getLegacySourceId = (operation: PortfolioOperation) =>
  getMetadataString(operation, "legacySourceId");

const getSaleId = (operation: PortfolioOperation) =>
  getMetadataString(operation, "saleId")
  ?? (getLegacySource(operation) === "sale" ? getLegacySourceId(operation) : null);

const getAdjustmentId = (operation: PortfolioOperation) =>
  getMetadataString(operation, "adjustmentId")
  ?? (getLegacySource(operation) === "realizedAdjustment" ? getLegacySourceId(operation) : null);

const getOperationResult = (operation: PortfolioOperation): AggregateOperationResult | null => {
  const direction = getMetadataString(operation, "positionDirection");
  const effect = getMetadataString(operation, "positionEffect");
  const isClosingTrade = (operation.operationType === "SELL" && effect !== "OPEN")
    || (operation.operationType === "BUY" && direction === "SHORT" && effect === "CLOSE");
  if (!isClosingTrade) return null;

  const realizedValue = getMetadataNumber(operation, "realizedProfitLossValue");
  const realizedCurrency = getMetadataString(operation, "realizedValueCurrency");
  if (realizedValue !== null && realizedCurrency) {
    return { amount: realizedValue, currency: realizedCurrency };
  }

  const realizedPln = getMetadataNumber(operation, "realizedProfitLossPln");
  return realizedPln === null ? null : { amount: realizedPln, currency: "PLN" };
};

const getOperationResultPln = (operation: PortfolioOperation): number | null => {
  const result = getOperationResult(operation);
  if (!result) return null;
  return getMetadataNumber(operation, "grossProfitLossPln")
    ?? getMetadataNumber(operation, "realizedProfitLossPln")
    ?? (result.currency === "PLN" ? result.amount : null);
};

const createAdjustmentOperation = (
  portfolio: AggregateOperationPortfolio,
  adjustment: PortfolioRealizedAdjustment,
): PortfolioOperation => {
  const createdAt = adjustment.createdAt || `${adjustment.date}T00:00:00.000Z`;
  return {
    id: `display-adjustment-${adjustment.id}`,
    portfolioId: portfolio.id,
    accountId: "",
    assetId: null,
    operationType: adjustment.source === "bond-coupon" ? "COUPON" : "CUSTOM",
    quantity: null,
    price: null,
    currency: adjustment.currency,
    exchangeRate: null,
    fee: 0,
    tax: 0,
    amount: adjustment.amount,
    date: adjustment.date,
    notes: adjustment.note ?? "",
    metadata: {
      legacySource: "realizedAdjustment",
      legacySourceId: adjustment.id,
      amountPlnSnapshot: adjustment.amountPlnSnapshot,
      source: adjustment.source,
      bondCode: adjustment.bondCode,
      displayProjectionOnly: true,
    },
    createdAt,
    updatedAt: createdAt,
  };
};

/**
 * Builds rows strictly inside each selected portfolio. In particular, instrument and
 * account IDs are never joined across portfolios, and distinct operations are never
 * collapsed even when their ticker, timestamp, or amount happen to match.
 */
export function buildAggregateOperationRows(
  portfolios: AggregateOperationPortfolio[],
): AggregateOperationRow[] {
  return portfolios
    .flatMap((portfolio) => {
      const instrumentsById = new Map((portfolio.instruments ?? []).map((item) => [item.id, item]));
      const accountsById = new Map((portfolio.accounts ?? []).map((item) => [item.id, item]));
      const assetsById = new Map((portfolio.assets ?? []).map((item) => [item.id, item]));
      const salesById = new Map((portfolio.sales ?? []).map((sale) => [sale.id, sale]));
      const adjustmentsById = new Map((portfolio.realizedAdjustments ?? []).map((adjustment) => [adjustment.id, adjustment]));
      const operations = portfolio.operations ?? [];
      const representedAdjustmentIds = new Set(operations.map(getAdjustmentId).filter((id): id is string => Boolean(id)));
      // Legacy adjustments are already synthesized into `operations` by the core
      // model. Add only adjustments (notably generated bond coupons) that have no
      // ledger representation, so history never shows a duplicate copy.
      const missingAdjustmentOperations = (portfolio.realizedAdjustments ?? [])
        .filter((adjustment) => !representedAdjustmentIds.has(adjustment.id))
        .map((adjustment) => createAdjustmentOperation(portfolio, adjustment));

      return [...operations, ...missingAdjustmentOperations].map((operation) => {
        const instrument = operation.assetId ? instrumentsById.get(operation.assetId) : undefined;
        const metadataSymbol = getMetadataString(operation, "symbol");
        const legacyAssetId = getMetadataString(operation, "legacySourceId") ?? getMetadataString(operation, "lotId");
        const legacyAsset = legacyAssetId ? assetsById.get(legacyAssetId) : undefined;
        const symbol = instrument?.symbol ?? legacyAsset?.symbol ?? metadataSymbol;
        const name = instrument?.name
          ?? legacyAsset?.name
          ?? getMetadataString(operation, "instrumentName")
          ?? getMetadataString(operation, "name");
        const saleId = getSaleId(operation);
        const adjustmentId = getAdjustmentId(operation);
        const sale = saleId ? salesById.get(saleId) ?? null : null;
        const realizedAdjustment = adjustmentId ? adjustmentsById.get(adjustmentId) ?? null : null;

        return {
          key: `${portfolio.id}:${operation.id}`,
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          operation,
          instrumentName: name,
          instrumentSymbol: symbol,
          instrumentType: instrument?.type ?? legacyAsset?.instrumentType ?? getMetadataString(operation, "instrumentType"),
          accountName: accountsById.get(operation.accountId)?.name ?? null,
          targetAccountName: accountsById.get(getMetadataString(operation, "targetAccountId") ?? "")?.name ?? null,
          result: getOperationResult(operation),
          resultPln: getOperationResultPln(operation),
          sale,
          realizedAdjustment,
          isSyntheticAdjustment: operation.metadata?.displayProjectionOnly === true,
        };
      });
    })
    .sort((left, right) =>
      right.operation.date.localeCompare(left.operation.date)
      || right.operation.createdAt.localeCompare(left.operation.createdAt)
      || left.key.localeCompare(right.key),
    );
}

const normalizeSearch = (value: string) => value
  .trim()
  .toLocaleLowerCase("pl-PL")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

export function filterAggregateOperationRows(
  rows: AggregateOperationRow[],
  filters: AggregateOperationFilters,
) {
  const query = normalizeSearch(filters.query ?? "");
  return rows.filter((row) => {
    if (filters.portfolioId && filters.portfolioId !== "all" && row.portfolioId !== filters.portfolioId) return false;
    if (filters.operationType && filters.operationType !== "all" && getAggregateOperationTypeLabel(row.operation) !== filters.operationType) return false;
    if (filters.instrument && filters.instrument !== "all") {
      const identity = row.instrumentSymbol ?? row.instrumentName ?? "";
      if (identity !== filters.instrument) return false;
    }
    if (filters.currency && filters.currency !== "all") {
      const currencies = [
        row.operation.currency,
        getMetadataString(row.operation, "marketCurrency"),
        getMetadataString(row.operation, "feeCurrency"),
        getMetadataString(row.operation, "taxCurrency"),
        getMetadataString(row.operation, "targetCurrency"),
        row.result?.currency,
      ];
      if (!currencies.includes(filters.currency)) return false;
    }
    if (filters.account && filters.account !== "all" && row.accountName !== filters.account && row.targetAccountName !== filters.account) return false;
    if (filters.dateFrom && row.operation.date.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && row.operation.date.slice(0, 10) > filters.dateTo) return false;
    if (query) {
      const haystack = normalizeSearch([
        row.portfolioName,
        getAggregateOperationTypeLabel(row.operation),
        row.operation.operationType,
        row.instrumentName ?? "",
        row.instrumentSymbol ?? "",
        row.operation.notes,
        row.accountName ?? "",
        row.targetAccountName ?? "",
        row.operation.date,
        row.operation.currency,
        getMetadataString(row.operation, "marketCurrency") ?? "",
        getMetadataString(row.operation, "feeCurrency") ?? "",
        getMetadataString(row.operation, "taxCurrency") ?? "",
        getMetadataString(row.operation, "targetCurrency") ?? "",
      ].join(" "));
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

const compareDate = (left: AggregateOperationRow, right: AggregateOperationRow, direction: "asc" | "desc") =>
  direction === "asc"
    ? left.operation.date.localeCompare(right.operation.date)
    : right.operation.date.localeCompare(left.operation.date);

export function sortAggregateOperationRows(
  rows: AggregateOperationRow[],
  sortMode: AggregateOperationSortMode,
) {
  return [...rows].sort((left, right) => {
    if (sortMode === "date-asc") return compareDate(left, right, "asc") || right.operation.createdAt.localeCompare(left.operation.createdAt) || left.key.localeCompare(right.key);
    if (sortMode === "date-desc") return compareDate(left, right, "desc") || right.operation.createdAt.localeCompare(left.operation.createdAt) || left.key.localeCompare(right.key);
    if (sortMode === "symbol-asc") {
      return (left.instrumentSymbol ?? left.instrumentName ?? "").localeCompare(right.instrumentSymbol ?? right.instrumentName ?? "")
        || compareDate(left, right, "desc")
        || left.key.localeCompare(right.key);
    }
    if (sortMode === "result-asc" || sortMode === "result-desc") {
      // Keep rows without a recorded PLN anchor at the bottom instead of
      // treating an unknown result as zero or comparing unlike currencies.
      if (left.resultPln === null && right.resultPln !== null) return 1;
      if (right.resultPln === null && left.resultPln !== null) return -1;
      if (left.resultPln !== null && right.resultPln !== null) {
        const difference = sortMode === "result-asc"
          ? left.resultPln - right.resultPln
          : right.resultPln - left.resultPln;
        if (difference !== 0) return difference;
      }
    }
    return right.operation.createdAt.localeCompare(left.operation.createdAt)
      || compareDate(left, right, "desc")
      || left.key.localeCompare(right.key);
  });
}

export function paginateAggregateOperationRows<T>(rows: T[], visibleCount: number) {
  return rows.slice(0, Math.max(0, visibleCount));
}

export const AGGREGATE_OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  BUY: "Kupno",
  SELL: "Sprzedaż",
  DEPOSIT: "Wpłata",
  WITHDRAW: "Wypłata",
  TRANSFER: "Przelew",
  DIVIDEND: "Dywidenda",
  COUPON: "Kupon obligacji",
  INTEREST: "Odsetki",
  FEE: "Opłata",
  TAX: "Podatek",
  CONVERSION: "Przewalutowanie",
  SPLIT: "Split",
  REVERSE_SPLIT: "Scalenie akcji",
  BONUS: "Bonus",
  CUSTOM: "Korekta",
};

export function getAggregateOperationTypeOptions(rows: AggregateOperationRow[]) {
  return Array.from(new Set([
    ...Object.values(AGGREGATE_OPERATION_TYPE_LABELS),
    ...rows.map((row) => getAggregateOperationTypeLabel(row.operation)),
  ]));
}

export function getAggregateOperationTypeLabel(operation: PortfolioOperation) {
  const direction = getMetadataString(operation, "positionDirection");
  const effect = getMetadataString(operation, "positionEffect");
  const transactionKind = getMetadataString(operation, "transactionKind");
  if (transactionKind === "bond-redemption") return "Wykup obligacji";
  if (transactionKind === "bond-swap") return "Zamiana obligacji";
  if (direction === "SHORT" && effect === "OPEN") return "Otwarcie shorta";
  if (direction === "SHORT" && effect === "CLOSE") return "Zamknięcie shorta";
  return AGGREGATE_OPERATION_TYPE_LABELS[operation.operationType];
}

export function getAggregateInstrumentTypeLabel(instrumentType: string | null) {
  if (!instrumentType) return null;
  const labels: Record<string, string> = {
    STOCK: "Akcja",
    ETF: "ETF",
    BOND: "Obligacja",
    CRYPTO: "Krypto",
    CFD: "Kontrakt CFD",
    ETC: "ETC",
    ETN: "ETN",
    FUND: "Fundusz",
    TERM_DEPOSIT: "Lokata",
    CASH: "Gotówka",
    OTHER: "Instrument",
  };
  return labels[instrumentType] ?? instrumentType;
}
