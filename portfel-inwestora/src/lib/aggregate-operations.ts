import type {
  InvestmentPortfolio,
  OperationType,
  PortfolioOperation,
} from "@/types/portfolio";

export type AggregateOperationPortfolio = Pick<
  InvestmentPortfolio,
  "id" | "name" | "operations" | "accounts" | "instruments" | "assets"
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
};

export type AggregateOperationFilters = {
  query?: string;
  portfolioId?: string;
  operationType?: string;
  instrument?: string;
  dateFrom?: string;
  dateTo?: string;
};

const getMetadataString = (operation: PortfolioOperation, key: string) => {
  const value = operation.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const getMetadataNumber = (operation: PortfolioOperation, key: string) => {
  const value = operation.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

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

      return (portfolio.operations ?? []).map((operation) => {
        const instrument = operation.assetId ? instrumentsById.get(operation.assetId) : undefined;
        const metadataSymbol = getMetadataString(operation, "symbol");
        const legacyAssetId = getMetadataString(operation, "legacySourceId") ?? getMetadataString(operation, "lotId");
        const legacyAsset = legacyAssetId ? assetsById.get(legacyAssetId) : undefined;
        const symbol = instrument?.symbol ?? legacyAsset?.symbol ?? metadataSymbol;
        const name = instrument?.name
          ?? legacyAsset?.name
          ?? getMetadataString(operation, "instrumentName")
          ?? getMetadataString(operation, "name");

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
        row.operation.date,
        row.operation.currency,
      ].join(" "));
      if (!haystack.includes(query)) return false;
    }
    return true;
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
