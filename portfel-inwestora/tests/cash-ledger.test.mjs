import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCashImpactBuyOperation,
  buildCashImpactSellOperation,
  calculateCashBalances,
  ensurePortfolioCoreModel,
  getOperationCashDeltas,
  isPortfolioAccountArchived,
  setPortfolioAccountArchived,
} from "../src/lib/operation-engine.ts";
import { buildCashOperation, buildCashHistory } from "../src/lib/cash-engine.ts";
import { getPortfolioSummary } from "../src/lib/portfolio-engine.ts";
import { buildPortfolioHistory } from "../src/lib/server/portfolio-history.ts";

const NOW = "2026-08-23T12:00:00.000Z";
const account = (id, currency) => ({
  id,
  portfolioId: "portfolio-1",
  name: `Gotówka ${currency}`,
  kind: currency === "PLN" ? "cash" : "currency",
  broker: "CASH",
  currency,
  isDefault: true,
  metadata: {},
  createdAt: NOW,
  updatedAt: NOW,
});
const plnAccount = account("portfolio-1:account:cash:PLN", "PLN");
const usdAccount = account("portfolio-1:account:cash:USD", "USD");
const eurAccount = account("portfolio-1:account:cash:EUR", "EUR");

const cashOperation = (overrides) =>
  buildCashOperation({
    id: overrides.id,
    portfolioId: "portfolio-1",
    accountId: overrides.accountId ?? plnAccount.id,
    operationType: overrides.operationType,
    amount: overrides.amount,
    currency: overrides.currency ?? "PLN",
    date: overrides.date ?? "2026-08-23",
    notes: overrides.notes ?? "",
    targetAccountId: overrides.targetAccountId,
    targetAmount: overrides.targetAmount,
    targetCurrency: overrides.targetCurrency,
    entryKind: overrides.entryKind,
    createdAt: overrides.createdAt ?? NOW,
  });

test("cash ledger handles deposits, withdrawals, conversions and signed adjustments", () => {
  const operations = [
    cashOperation({ id: "initial", operationType: "DEPOSIT", amount: 10_000, entryKind: "INITIAL_BALANCE" }),
    cashOperation({ id: "withdraw", operationType: "WITHDRAW", amount: 500 }),
    cashOperation({
      id: "conversion",
      operationType: "CONVERSION",
      accountId: plnAccount.id,
      amount: 1_000,
      currency: "PLN",
      targetAccountId: usdAccount.id,
      targetAmount: 250,
      targetCurrency: "USD",
    }),
    cashOperation({ id: "correction-plus", operationType: "CUSTOM", amount: 12.5, entryKind: "BALANCE_ADJUSTMENT" }),
    cashOperation({ id: "correction-minus", operationType: "CUSTOM", amount: -2.5, entryKind: "BALANCE_ADJUSTMENT" }),
  ];

  assert.deepEqual(calculateCashBalances(operations, [plnAccount, usdAccount]), [
    { accountId: plnAccount.id, currency: "PLN", amount: 8510 },
    { accountId: usdAccount.id, currency: "USD", amount: 250 },
  ]);
});

test("multi-currency balances stay separate and use the existing FX valuation fallback", () => {
  const operations = [
    cashOperation({ id: "pln", operationType: "DEPOSIT", amount: 100, currency: "PLN", accountId: plnAccount.id }),
    cashOperation({ id: "usd", operationType: "DEPOSIT", amount: 20, currency: "USD", accountId: usdAccount.id }),
    cashOperation({ id: "eur", operationType: "DEPOSIT", amount: 10, currency: "EUR", accountId: eurAccount.id }),
  ];
  const balances = calculateCashBalances(operations, [plnAccount, usdAccount, eurAccount]);

  assert.deepEqual(balances, [
    { accountId: eurAccount.id, currency: "EUR", amount: 10 },
    { accountId: plnAccount.id, currency: "PLN", amount: 100 },
    { accountId: usdAccount.id, currency: "USD", amount: 20 },
  ]);
  assert.equal(getPortfolioSummary([], [], [], { PLN: 1, USD: 4, EUR: 4.5 }, "PLN", balances).cashValue, 225);
  assert.ok(Number.isFinite(getPortfolioSummary([], [], [], { PLN: 1 }, "PLN", balances).cashValue));
});

test("an internal transfer moves cash between accounts without changing the currency total", () => {
  const secondPlnAccount = { ...account("portfolio-1:account:cash:PLN:second", "PLN"), isDefault: false };
  const operations = [
    cashOperation({ id: "seed", operationType: "DEPOSIT", amount: 1_000 }),
    cashOperation({ id: "move", operationType: "TRANSFER", amount: 250, targetAccountId: secondPlnAccount.id, targetAmount: 250, targetCurrency: "PLN" }),
  ];
  const balances = calculateCashBalances(operations, [plnAccount, secondPlnAccount]);

  assert.deepEqual(balances, [
    { accountId: plnAccount.id, currency: "PLN", amount: 750 },
    { accountId: secondPlnAccount.id, currency: "PLN", amount: 250 },
  ]);
  assert.equal(balances.reduce((total, balance) => total + balance.amount, 0), 1_000);
});

test("archived cash accounts leave current totals but retain their ledger and transfer history", async () => {
  const replacementAccount = { ...account("portfolio-1:account:cash:PLN:replacement", "PLN"), isDefault: false };
  const archivedAccount = setPortfolioAccountArchived(plnAccount, true, "2026-08-24T09:00:00.000Z");
  const operations = [
    cashOperation({ id: "archive-seed", operationType: "DEPOSIT", amount: 1_000, date: "2026-08-22" }),
    cashOperation({ id: "archive-transfer", operationType: "TRANSFER", amount: 1_000, date: "2026-08-23", targetAccountId: replacementAccount.id, targetAmount: 1_000, targetCurrency: "PLN" }),
  ];
  const portfolio = {
    id: "portfolio-1",
    name: "Archiwum",
    baseCurrency: "PLN",
    assets: [],
    sales: [],
    realizedAdjustments: [],
    accounts: [archivedAccount, replacementAccount],
    instruments: [],
    operations,
    createdAt: NOW,
    updatedAt: NOW,
  };

  assert.equal(isPortfolioAccountArchived(archivedAccount), true);
  assert.deepEqual(calculateCashBalances(operations, portfolio.accounts), [
    { accountId: replacementAccount.id, currency: "PLN", amount: 1_000 },
  ]);
  const normalized = ensurePortfolioCoreModel(portfolio);
  assert.equal(normalized.accounts.some((candidate) => candidate.id === archivedAccount.id), true);
  assert.equal(buildCashHistory(normalized).filter((entry) => entry.accountId === archivedAccount.id).length, 2);

  const history = await buildPortfolioHistory({
    assets: [], sales: [], realizedAdjustments: [], operations, accounts: portfolio.accounts,
  });
  assert.deepEqual(
    (({ portfolioValuePln, netInvestedPln, profitLossPln }) => ({ portfolioValuePln, netInvestedPln, profitLossPln }))(history.points.at(-1)),
    { portfolioValuePln: 1_000, netInvestedPln: 1_000, profitLossPln: 0 }
  );
});

test("archiving a non-zero stale balance is a neutral external removal and restoration is explicit", async () => {
  const archivedAccount = setPortfolioAccountArchived(plnAccount, true, "2026-08-23T18:00:00.000Z");
  const operations = [
    cashOperation({ id: "stale-seed", operationType: "DEPOSIT", amount: 250, date: "2026-08-22" }),
  ];
  const history = await buildPortfolioHistory({
    assets: [], sales: [], realizedAdjustments: [], operations, accounts: [archivedAccount],
  });
  const latest = history.points.at(-1);

  assert.deepEqual(
    { value: latest.portfolioValuePln, invested: latest.netInvestedPln, profit: latest.profitLossPln },
    { value: 0, invested: 0, profit: 0 }
  );
  const restored = setPortfolioAccountArchived(archivedAccount, false, "2026-08-25T09:00:00.000Z");
  assert.equal(isPortfolioAccountArchived(restored), false);
  assert.equal(restored.metadata.lastArchivedAt, "2026-08-23T18:00:00.000Z");
});

test("new buy and sell operations affect cash while legacy positions remain neutral", () => {
  const asset = {
    id: "lot-1",
    name: "Test USA",
    symbol: "TEST.US",
    kind: "stock",
    purchaseDate: "2026-08-20",
    quantity: 2,
    purchasePrice: 100,
    purchaseCurrency: "USD",
    purchasePriceCurrency: "USD",
    purchaseFxRateToPln: 4,
    purchaseSettlementFxRateToPln: 4,
    feePln: 5,
    marketCurrency: "USD",
    provider: "stooq",
    createdAt: NOW,
  };
  const buy = buildCashImpactBuyOperation("portfolio-1", asset);
  assert.deepEqual(getOperationCashDeltas(buy), [
    { accountId: usdAccount.id, currency: "USD", amount: -200 },
    { accountId: plnAccount.id, currency: "PLN", amount: -5 },
  ]);
  assert.deepEqual(
    getOperationCashDeltas({ ...buy, metadata: { ...buy.metadata, cashImpact: false } }),
    []
  );

  const sale = {
    id: "sale-1",
    assetKey: "stock:TEST.US",
    name: "Test USA",
    symbol: "TEST.US",
    kind: "stock",
    transactionKind: "market-sale",
    quantity: 1,
    salePrice: 110,
    saleDate: "2026-08-22",
    feePln: 4,
    taxTotalPln: 0,
    realizedInvestedPln: 400,
    realizedProceedsPln: 436,
    realizedProfitLossPln: 36,
    realizedProceedsValue: 109,
    realizedValueCurrency: "USD",
    realizedProfitLossValue: 9,
    marketCurrency: "USD",
    allocations: [{ lotId: "lot-1", quantity: 1, purchaseDate: "2026-08-20", purchasePrice: 100, purchaseCurrency: "USD", allocatedBuyFeePln: 2.5, investedPln: 400 }],
    createdAt: NOW,
  };
  const sell = buildCashImpactSellOperation("portfolio-1", sale);
  assert.deepEqual(getOperationCashDeltas(sell), [
    { accountId: usdAccount.id, currency: "USD", amount: 109 },
  ]);
});

test("existing imported trades are deterministically linked to their legacy lot", () => {
  const asset = {
    id: "imported-lot",
    name: "Import test",
    symbol: "IMP.US",
    kind: "stock",
    purchaseDate: "2026-08-20",
    quantity: 3,
    purchasePrice: 20,
    purchaseCurrency: "USD",
    purchasePriceCurrency: "USD",
    purchaseFxRateToPln: 4,
    purchaseSettlementFxRateToPln: 4,
    feePln: 0,
    marketCurrency: "USD",
    provider: "stooq",
    createdAt: NOW,
  };
  const cashBuy = buildCashImpactBuyOperation("portfolio-1", asset);
  const importedWithoutLotId = {
    ...cashBuy,
    id: "imported-buy",
    metadata: { ...cashBuy.metadata, lotId: undefined, importSource: "XTB" },
  };
  const normalized = ensurePortfolioCoreModel({
    id: "portfolio-1",
    name: "Import",
    baseCurrency: "PLN",
    assets: [asset],
    sales: [],
    realizedAdjustments: [],
    accounts: [plnAccount, usdAccount],
    instruments: [],
    operations: [importedWithoutLotId],
    createdAt: NOW,
    updatedAt: NOW,
  });

  assert.equal(
    normalized.operations.find((operation) => operation.id === "imported-buy")?.metadata.lotId,
    asset.id
  );
  assert.equal(
    normalized.operations.filter((operation) => operation.operationType === "BUY").length,
    1
  );
});

test("paid dividend increases cash by net amount exactly once", () => {
  const dividend = {
    id: "dividend-1",
    portfolioId: "portfolio-1",
    accountId: plnAccount.id,
    assetId: null,
    operationType: "DIVIDEND",
    quantity: 10,
    price: 10,
    currency: "PLN",
    exchangeRate: 1,
    fee: 0,
    tax: 19,
    amount: 100,
    date: "2026-08-20",
    notes: "",
    metadata: { cashImpact: true, netAmount: 81 },
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.deepEqual(calculateCashBalances([dividend], [plnAccount]), [
    { accountId: plnAccount.id, currency: "PLN", amount: 81 },
  ]);
});

test("cash may be negative and history remains auditable", () => {
  const withdrawal = cashOperation({ id: "negative", operationType: "WITHDRAW", amount: 125, notes: "Test ujemnego salda" });
  const portfolio = {
    id: "portfolio-1",
    name: "Test",
    baseCurrency: "PLN",
    assets: [],
    sales: [],
    realizedAdjustments: [],
    accounts: [plnAccount],
    instruments: [],
    operations: [withdrawal],
  };
  assert.equal(calculateCashBalances([withdrawal], [plnAccount])[0].amount, -125);
  const history = buildCashHistory(portfolio);
  assert.equal(history.length, 1);
  assert.equal(history[0].amount, -125);
  assert.equal(history[0].balanceAfter, -125);
});

test("cash contributes to portfolio value but never changes investment P/L", () => {
  const balances = [{ accountId: plnAccount.id, currency: "PLN", amount: 1_000 }];
  const summary = getPortfolioSummary([], [], [], { PLN: 1, USD: 4 }, "PLN", balances);
  assert.equal(summary.cashValue, 1_000);
  assert.equal(summary.totalValue, 1_000);
  assert.equal(summary.marketValue, 0);
  assert.equal(summary.combinedProfitLoss, 0);
  assert.equal(summary.totalProfitLoss, 0);
});

test("editing uses one stable operation identity instead of double counting", () => {
  const original = cashOperation({ id: "stable", operationType: "DEPOSIT", amount: 100, createdAt: NOW });
  const edited = buildCashOperation({
    id: original.id,
    portfolioId: original.portfolioId,
    accountId: original.accountId,
    operationType: "DEPOSIT",
    amount: 150,
    currency: "PLN",
    date: original.date,
    notes: "Po korekcie",
    createdAt: original.createdAt,
    updatedAt: "2026-08-23T13:00:00.000Z",
  });
  const operations = [original].map((operation) =>
    operation.id === edited.id ? edited : operation
  );
  assert.equal(calculateCashBalances(operations, [plnAccount])[0].amount, 150);
  assert.equal(edited.createdAt, original.createdAt);
  assert.notEqual(edited.updatedAt, original.updatedAt);
});

test("deposits and withdrawals change history value without creating investment profit", async () => {
  const operations = [
    cashOperation({ id: "history-deposit", operationType: "DEPOSIT", amount: 1_000, date: "2026-08-22" }),
    cashOperation({ id: "history-withdraw", operationType: "WITHDRAW", amount: 400, date: "2026-08-23" }),
  ];
  const history = await buildPortfolioHistory({
    assets: [],
    sales: [],
    realizedAdjustments: [],
    operations,
    accounts: [plnAccount],
  });

  const values = history.points.map(
    ({ date, portfolioValuePln, netInvestedPln, profitLossPln }) => ({
      date,
      portfolioValuePln,
      netInvestedPln,
      profitLossPln,
    })
  );

  assert.deepEqual(
    values.slice(0, 2),
    [
      { date: "2026-08-22", portfolioValuePln: 1_000, netInvestedPln: 1_000, profitLossPln: 0 },
      { date: "2026-08-23", portfolioValuePln: 600, netInvestedPln: 600, profitLossPln: 0 },
    ]
  );
  assert.ok(
    values.slice(2).every(
      ({ portfolioValuePln, netInvestedPln, profitLossPln }) =>
        portfolioValuePln === 600 && netInvestedPln === 600 && profitLossPln === 0
    )
  );
});

test("interest is cash income and therefore appears as investment profit", async () => {
  const operations = [
    cashOperation({ id: "income-deposit", operationType: "DEPOSIT", amount: 1_000, date: "2026-08-22" }),
    cashOperation({ id: "income-interest", operationType: "INTEREST", amount: 25, date: "2026-08-23" }),
  ];
  const history = await buildPortfolioHistory({
    assets: [],
    sales: [],
    realizedAdjustments: [],
    operations,
    accounts: [plnAccount],
  });
  const latest = history.points.at(-1);

  assert.equal(latest.portfolioValuePln, 1_025);
  assert.equal(latest.netInvestedPln, 1_000);
  assert.equal(latest.profitLossPln, 25);
});
