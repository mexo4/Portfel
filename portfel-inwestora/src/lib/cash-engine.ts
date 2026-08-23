import { BASE_CURRENCY } from "@/lib/constants";
import { getOperationCashDeltas } from "@/lib/operation-engine";
import { round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type {
  CashHistoryEntry,
  CurrencyCode,
  InvestmentPortfolio,
  OperationType,
  PortfolioOperation,
} from "@/types/portfolio";

export type CashOperationKind =
  | "DEPOSIT"
  | "WITHDRAW"
  | "TRANSFER"
  | "CONVERSION"
  | "INTEREST"
  | "FEE"
  | "CUSTOM";

export type CashEntryKind =
  | "STANDARD"
  | "INITIAL_BALANCE"
  | "BALANCE_ADJUSTMENT";

const CASH_OPERATION_TYPES = new Set<OperationType>([
  "DEPOSIT",
  "WITHDRAW",
  "TRANSFER",
  "INTEREST",
  "FEE",
  "TAX",
  "CONVERSION",
  "CUSTOM",
]);

export const isCashOperation = (operation: PortfolioOperation) =>
  CASH_OPERATION_TYPES.has(operation.operationType) ||
  getOperationCashDeltas(operation).length > 0;

export const buildCashOperation = ({
  id,
  portfolioId,
  accountId,
  targetAccountId,
  targetCurrency,
  targetAmount,
  operationType,
  amount,
  currency,
  date,
  notes,
  entryKind = "STANDARD",
  createdAt,
  updatedAt,
}: {
  id: string;
  portfolioId: string;
  accountId: string;
  targetAccountId?: string;
  targetCurrency?: CurrencyCode;
  targetAmount?: number;
  operationType: CashOperationKind;
  amount: number;
  currency: CurrencyCode;
  date: string;
  notes: string;
  entryKind?: CashEntryKind;
  createdAt?: string;
  updatedAt?: string;
}): PortfolioOperation => {
  const currentTimestamp = new Date().toISOString();
  const normalizedCreatedAt = createdAt ?? currentTimestamp;
  const normalizedCurrency = toCurrencyCode(currency, BASE_CURRENCY);
  const normalizedAmount = round(
    operationType === "CUSTOM" ? amount : Math.abs(amount),
    8
  );
  const normalizedTargetAmount = round(
    Math.abs(targetAmount ?? normalizedAmount),
    8
  );
  const normalizedTargetCurrency = toCurrencyCode(
    targetCurrency,
    normalizedCurrency
  );

  return {
    id,
    portfolioId,
    accountId,
    assetId: null,
    operationType,
    quantity: null,
    price: null,
    currency: normalizedCurrency,
    exchangeRate: normalizedCurrency === BASE_CURRENCY ? 1 : null,
    fee: operationType === "FEE" ? normalizedAmount : 0,
    tax: 0,
    amount: normalizedAmount,
    date: toDateInputValue(date),
    notes: notes.trim(),
    metadata: {
      kind: "cash",
      cashEntryKind: entryKind,
      cashImpact: true,
      ...(targetAccountId
        ? {
            targetAccountId,
            targetAmount: normalizedTargetAmount,
            targetCurrency: normalizedTargetCurrency,
          }
        : {}),
    },
    createdAt: normalizedCreatedAt,
    updatedAt: updatedAt ?? currentTimestamp,
  };
};

export const buildCashHistory = (
  portfolio: InvestmentPortfolio
): CashHistoryEntry[] => {
  const accounts = portfolio.accounts ?? [];
  const accountsById = new Map(
    accounts.map((account) => [account.id, account.name] as const)
  );
  const activeAccountIds =
    accounts.length > 0 ? new Set(accountsById.keys()) : null;
  const balancesByKey = new Map<string, number>();
  const entries: CashHistoryEntry[] = [];

  [...(portfolio.operations ?? [])]
    .filter(isCashOperation)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    )
    .forEach((operation) => {
      getOperationCashDeltas(operation).forEach((delta, index) => {
        if (activeAccountIds && !activeAccountIds.has(delta.accountId)) {
          return;
        }

        const key = `${delta.accountId}:${delta.currency}`;
        const nextBalance = round((balancesByKey.get(key) ?? 0) + delta.amount, 6);
        balancesByKey.set(key, nextBalance);

        entries.push({
          id: `${operation.id}:${index}`,
          operationId: operation.id,
          date: operation.date,
          operationType: operation.operationType,
          accountId: delta.accountId,
          accountName: accountsById.get(delta.accountId) ?? "Konto",
          amount: round(delta.amount, 6),
          currency: delta.currency,
          balanceAfter: nextBalance,
          notes: operation.notes,
        });
      });
    });

  return entries.sort(
    (left, right) =>
      right.date.localeCompare(left.date) || right.id.localeCompare(left.id)
  );
};
