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
  | "INTEREST"
  | "FEE"
  | "CUSTOM";

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
  operationType,
  amount,
  currency,
  date,
  notes,
  createdAt,
}: {
  id: string;
  portfolioId: string;
  accountId: string;
  targetAccountId?: string;
  operationType: CashOperationKind;
  amount: number;
  currency: CurrencyCode;
  date: string;
  notes: string;
  createdAt?: string;
}): PortfolioOperation => {
  const now = createdAt ?? new Date().toISOString();
  const normalizedCurrency = toCurrencyCode(currency, BASE_CURRENCY);
  const normalizedAmount = round(Math.abs(amount), 6);

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
      ...(targetAccountId ? { targetAccountId, targetAmount: normalizedAmount } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
};

export const buildCashHistory = (
  portfolio: InvestmentPortfolio
): CashHistoryEntry[] => {
  const accountsById = new Map(
    (portfolio.accounts ?? []).map((account) => [account.id, account.name] as const)
  );
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
