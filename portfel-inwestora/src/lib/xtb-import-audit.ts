import type { ImportedBrokerOperation } from "@/lib/import-operations";
import type { InvestmentPortfolio } from "@/types/portfolio";

export type XtbImportFinding = {
  portfolioId: string;
  operationId: string;
  code: string;
  severity: "REVIEW" | "ERROR";
  evidence: Record<string, unknown>;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const differs = (a: number, b: number) => Math.abs(a - b) > Math.max(0.02, Math.abs(b) * 0.0005);

/** Inspect the stored document before normalization: normalization itself can
 * repair old metadata, which would conceal the original evidence in an audit.
 * This function is pure and never saves a portfolio or removes its history. */
export const auditXtbPortfolio = (
  portfolio: InvestmentPortfolio,
  sourceOperations: ImportedBrokerOperation[] = []
): XtbImportFinding[] => {
  const findings: XtbImportFinding[] = [];
  const seen = new Map<string, { id: string; type: string; importKey: unknown }>();
  const accounts = new Map((portfolio.accounts ?? []).map((account) => [account.id, account]));
  for (const operation of portfolio.operations ?? []) {
    const meta = operation.metadata ?? {};
    if (String(meta.importSource ?? "").toUpperCase() !== "XTB" || meta.autoFxForOperationId) continue;
    const add = (code: string, evidence: Record<string, unknown>, severity: "REVIEW" | "ERROR" = "REVIEW") =>
      findings.push({ portfolioId: portfolio.id, operationId: operation.id, code, severity, evidence });
    const brokerId = String(meta.brokerOperationId ?? "");
    const accountNumber = String(meta.accountNumber ?? "");
    if (brokerId && accountNumber) {
      const key = `${accountNumber}:${brokerId}`;
      const previous = seen.get(key);
      if (previous) add("DUPLICATE_BROKER_OPERATION", {
        brokerId, previousOperationId: previous.id,
        previousType: previous.type, currentType: operation.operationType,
        sameImportKey: Boolean(meta.importKey && meta.importKey === previous.importKey),
      });
      seen.set(key, { id: operation.id, type: operation.operationType, importKey: meta.importKey });
    }
    const account = accounts.get(operation.accountId);
    if (accountNumber && account?.metadata?.accountNumber && String(account.metadata.accountNumber) !== accountNumber) {
      add("STATEMENT_ACCOUNT_MISMATCH", { statement: accountNumber, assigned: account.metadata.accountNumber }, "ERROR");
    }
    if (operation.operationType === "FEE" &&
      !(portfolio.realizedAdjustments ?? []).some((adjustment) => adjustment.importKey === `${meta.importKey}:result`) &&
      !meta.linkedFeeImportKey) {
      add("COMMISSION_RESULT_REQUIRES_ATTRIBUTION", { amount: operation.amount, currency: operation.currency });
    }
    if (operation.operationType !== "BUY" && operation.operationType !== "SELL") continue;
    // XTB's CLOSE BUY describes the long position being closed, not a purchase.
    // This signature can be detected in stored records even without the XLSX.
    const rawType = String(meta.brokerOperationType ?? meta.rawType ?? "").trim().toLowerCase();
    if (/^stock (sell|sale)$/.test(rawType) && operation.operationType === "BUY") {
      add("STOCK_SALE_STORED_AS_BUY", { rawType, storedType: operation.operationType, expectedType: "SELL" }, "ERROR");
    }
    const marketCurrency = String(meta.marketCurrency ?? operation.currency);
    const cashCurrency = String(meta.cashCurrency ?? operation.currency);
    const marketAmount = finite(meta.marketAmount) ? meta.marketAmount : 0;
    const cashAmount = finite(meta.cashAmount) ? meta.cashAmount : Math.abs(operation.amount);
    const multiplier = finite(meta.contractMultiplier) ? meta.contractMultiplier : 1;
    const unitTotal = (operation.quantity ?? 0) * (operation.price ?? 0) * multiplier;
    if (marketAmount > 0 && differs(unitTotal, marketAmount)) {
      add("UNIT_PRICE_TOTAL_MISMATCH", { unitTotal, marketAmount }, "ERROR");
    }
    if (marketCurrency !== cashCurrency && operation.exchangeRate === 1) {
      add("CROSS_CURRENCY_PARITY_REQUIRES_SOURCE", { marketCurrency, cashCurrency, marketAmount, cashAmount });
    }
    if (marketCurrency === cashCurrency && marketAmount > 0 && cashAmount > 0 && differs(cashAmount, marketAmount)) {
      add("SAME_CURRENCY_SETTLEMENT_MISMATCH", { marketCurrency, marketAmount, cashAmount });
    }
    const lot = (portfolio.assets ?? []).find((asset) => asset.id === meta.lotId);
    if (lot && cashCurrency !== "PLN" && meta.historicalFxVerified !== true) {
      add("HISTORICAL_FX_PROVENANCE_MISSING", { date: operation.date, cashCurrency });
    }
    if (lot && operation.fee > 0 && lot.feePln === 0) {
      add("COMMISSION_MISSING_FROM_LOT_COST", { fee: operation.fee, cashCurrency }, "ERROR");
    }
    const source = sourceOperations.find((row) => brokerId && row.brokerOperationId === brokerId && row.accountNumber === accountNumber);
    if (!source) continue;
    const expected = {
      operationType: source.operationType,
      quantity: source.quantity, price: source.price,
      marketCurrency: source.marketCurrency ?? source.currency,
      cashCurrency: source.cashCurrency ?? source.accountCurrency ?? source.currency,
      marketAmount: source.marketAmount, cashAmount: source.cashAmount,
    };
    if (operation.operationType !== expected.operationType ||
        operation.quantity !== expected.quantity || operation.price !== expected.price ||
        marketCurrency !== expected.marketCurrency || cashCurrency !== expected.cashCurrency ||
        (finite(expected.cashAmount) && differs(cashAmount, expected.cashAmount))) {
      add("SOURCE_TRADE_MISMATCH", {
        before: { operationType: operation.operationType, quantity: operation.quantity, price: operation.price, marketCurrency, cashCurrency, marketAmount, cashAmount },
        expected,
        correction: "SOURCE_BACKED_REIMPORT_REQUIRED_WITH_LINKED_LOTS_AND_SALES",
      }, "ERROR");
    }
  }
  return findings;
};
