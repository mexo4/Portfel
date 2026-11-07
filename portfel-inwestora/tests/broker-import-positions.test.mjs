import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBrokerOperationsCsv,
  parseXtbCashOperationRows,
} from "../src/lib/import-operations.ts";
import {
  applySaleToPortfolio,
  normalizeStoredPortfolioAssets,
} from "../src/lib/portfolio-state.ts";
import {
  getAssetMarketValuePln,
  getAssetProfitLossPln,
  getGroupedPortfolioAssets,
  getPortfolioSummary,
} from "../src/lib/portfolio-engine.ts";
import { buildCashOperation } from "../src/lib/cash-engine.ts";
import {
  buildOperationsFromLegacyState,
  calculateCashBalances,
} from "../src/lib/operation-engine.ts";
import { getPortfolioAssetGroupKey } from "../src/lib/ticker.ts";

const NOW = "2026-09-08T10:00:00.000Z";
const FX = { PLN: 1, USD: 4 };

const assetFromOperation = (operation, overrides = {}) => ({
  id: overrides.id ?? `lot-${operation.rowNumber}`,
  name: operation.name,
  symbol: operation.symbol,
  kind: operation.kind,
  instrumentType: operation.instrumentType,
  positionDirection: operation.positionDirection,
  contractMultiplier: operation.contractMultiplier,
  purchaseDate: operation.date,
  quantity: operation.quantity,
  purchasePrice: operation.price,
  purchaseCurrency: operation.currency,
  purchasePriceCurrency: operation.currency,
  purchaseFxRateToPln: operation.currency === "PLN" ? 1 : 4,
  purchaseSettlementFxRateToPln: operation.currency === "PLN" ? 1 : 4,
  feePln:
    operation.feePln +
    Math.abs(operation.financing ?? 0) * (operation.currency === "PLN" ? 1 : 4),
  marketCurrency: operation.currency,
  provider: operation.provider,
  createdAt: NOW,
  ...overrides,
});

const closePosition = (assets, operation) => {
  const group = getGroupedPortfolioAssets(assets, FX).find(
    (candidate) => candidate.positionDirection === operation.positionDirection
  );
  assert.ok(group);

  return applySaleToPortfolio({
    assets,
    group,
    draft: {
      groupKey: group.key,
      name: group.name,
      symbol: group.symbol,
      kind: group.kind,
      purchaseCurrency: operation.currency,
      marketCurrency: operation.currency,
      provider: group.lots[0].provider,
      providerId: group.lots[0].providerId,
      maxQuantity: group.quantity,
      quantity: operation.quantity,
      quantityInput: String(operation.quantity),
      salePrice: operation.price,
      salePriceInput: String(operation.price),
      saleDate: operation.date,
      feePln:
        operation.feePln +
        Math.abs(operation.financing ?? 0) * (operation.currency === "PLN" ? 1 : 4),
    },
    fxRates: FX,
  });
};

test("XTB transfer from another account stays scoped to the imported statement account", () => {
  const result = parseXtbCashOperationRows(
    [
      ["Account number", "222222"],
      ["Currency", "PLN"],
      ["ID", "Type", "Time", "Comment", "Symbol", "Amount", "Instrument"],
      [
        "1001",
        "Transfer",
        "08/09/2026 10:00:00",
        "Transfer from 111111 to 222222",
        "",
        "500.00",
        "",
      ],
    ],
    "XTB fixture"
  );

  assert.ok(result);
  assert.equal(result.operations.length, 1);
  assert.deepEqual(
    (({ operationType, accountNumber, targetAccountNumber, amount, currency }) => ({
      operationType,
      accountNumber,
      targetAccountNumber,
      amount,
      currency,
    }))(result.operations[0]),
    {
      operationType: "DEPOSIT",
      accountNumber: "222222",
      targetAccountNumber: undefined,
      amount: 500,
      currency: "PLN",
    }
  );
  assert.equal(result.operations[0].counterpartyAccountNumber, "111111");
});

test("generic unsupported instrument keeps its buy and closed-position result without a quote", () => {
  const result = parseBrokerOperationsCsv(
    [
      "Type;Date;Symbol;Name;Quantity;Price;Currency;Value;Asset Type",
      "Buy;01.09.2026;LEGACY1;Legacy warrant;10;100;PLN;1000;Warrant",
      "Sell;05.09.2026;LEGACY1;Legacy warrant;10;140;PLN;1400;Warrant",
    ].join("\n"),
    "generic"
  );

  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.operations.length, 2);
  assert.ok(result.operations.every((operation) => operation.instrumentType === "OTHER"));

  const assets = normalizeStoredPortfolioAssets([assetFromOperation(result.operations[0])]);
  const closed = closePosition(assets, result.operations[1]);

  assert.equal(closed.assets.length, 0);
  assert.equal(closed.sale.realizedInvestedPln, 1_000);
  assert.equal(closed.sale.realizedProceedsPln, 1_400);
  assert.equal(closed.sale.realizedProfitLossPln, 400);
});

test("open unsupported instrument has no fabricated live price", () => {
  const result = parseBrokerOperationsCsv(
    [
      "Type;Date;Symbol;Name;Quantity;Price;Currency;Value;Asset Type",
      "Buy;01.09.2026;PRIVATE1;Imported legacy asset;3;250;PLN;750;Private asset",
    ].join("\n"),
    "generic"
  );
  const asset = assetFromOperation(result.operations[0]);

  assert.equal(asset.instrumentType, "OTHER");
  assert.equal(asset.latestPrice, undefined);
  assert.equal(getGroupedPortfolioAssets([asset], FX)[0].hasLivePrice, false);
});

test("standalone closed legacy row preserves broker realized result for import recovery", () => {
  const result = parseBrokerOperationsCsv(
    [
      "Type;Date;Symbol;Name;Quantity;Price;Currency;Asset Type;Realized Profit Loss;Purchase Value;Sale Value",
      "Sell;05.09.2026;OLDTOKEN;Legacy token;2;7000;PLN;Legacy token;4000;10000;14000",
    ].join("\n"),
    "generic"
  );
  const [operation] = result.operations;

  assert.equal(operation.instrumentType, "OTHER");
  assert.equal(operation.positionEffect, "CLOSE");
  assert.equal(operation.realizedProfitLoss, 4_000);
  assert.equal(operation.purchaseValue, 10_000);
  assert.equal(operation.saleValue, 14_000);
});

test("CFD short uses inverse P/L, multiplier and supports partial closes", () => {
  const result = parseBrokerOperationsCsv(
    [
      "Type;Date;Symbol;Name;Quantity;Price;Currency;Value;Asset Type;Direction;Position Effect;Contract Size;Fee;Financing",
      "Open Short;01.09.2026;TSLA.CFD;Tesla CFD;2;350;USD;700;CFD;SHORT;OPEN;1;4;0",
      "Close Short;03.09.2026;TSLA.CFD;Tesla CFD;1;320;USD;320;CFD;SHORT;CLOSE;1;2;1.5",
      "Close Short;04.09.2026;TSLA.CFD;Tesla CFD;1;330;USD;330;CFD;SHORT;CLOSE;1;2;0",
    ].join("\n"),
    "generic"
  );

  assert.equal(result.skippedRows.length, 0);
  assert.deepEqual(
    result.operations.map(({ operationType, instrumentType, positionDirection, positionEffect }) => ({
      operationType,
      instrumentType,
      positionDirection,
      positionEffect,
    })),
    [
      { operationType: "SELL", instrumentType: "CFD", positionDirection: "SHORT", positionEffect: "OPEN" },
      { operationType: "BUY", instrumentType: "CFD", positionDirection: "SHORT", positionEffect: "CLOSE" },
      { operationType: "BUY", instrumentType: "CFD", positionDirection: "SHORT", positionEffect: "CLOSE" },
    ]
  );

  const openingAsset = assetFromOperation(result.operations[0]);
  const firstClose = closePosition([openingAsset], result.operations[1]);

  assert.equal(firstClose.assets.length, 1);
  assert.equal(firstClose.assets[0].quantity, 1);
  assert.equal(firstClose.sale.realizedProfitLossPln, 110);

  const secondClose = closePosition(firstClose.assets, result.operations[2]);
  assert.equal(secondClose.assets.length, 0);
  assert.equal(secondClose.sale.realizedProfitLossPln, 76);
});

test("open CFD short marks a falling underlying as a profit", () => {
  const asset = assetFromOperation(
    {
      rowNumber: 1,
      name: "Index CFD",
      symbol: "US100.CFD",
      kind: "stock",
      instrumentType: "CFD",
      positionDirection: "SHORT",
      contractMultiplier: 10,
      date: "2026-09-01",
      quantity: 1,
      price: 350,
      currency: "USD",
      feePln: 0,
      provider: "catalog",
    },
    { latestPrice: 320 }
  );

  assert.equal(getAssetProfitLossPln(asset, FX), 1_200);
  assert.equal(getAssetMarketValuePln(asset, FX), 1_200);
});

test("manual short and CFD positions use marked P/L as portfolio value and settle once through cash", () => {
  const cashAccountId = "portfolio:account:cash:PLN";
  const account = {
    id: cashAccountId,
    portfolioId: "portfolio",
    name: "Gotówka PLN",
    kind: "cash",
    broker: "CASH",
    currency: "PLN",
    isDefault: true,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
  const deposit = buildCashOperation({
    id: "seed-cash",
    portfolioId: "portfolio",
    accountId: cashAccountId,
    operationType: "DEPOSIT",
    amount: 10_000,
    currency: "PLN",
    date: "2026-09-01",
    notes: "Test capital",
    createdAt: NOW,
  });
  const short = {
    id: "manual-short",
    name: "Test short",
    symbol: "TEST",
    kind: "stock",
    instrumentType: "STOCK",
    positionDirection: "SHORT",
    purchaseDate: "2026-09-01",
    quantity: 1,
    purchasePrice: 350,
    purchaseCurrency: "PLN",
    purchasePriceCurrency: "PLN",
    purchaseFxRateToPln: 1,
    feePln: 4,
    marketCurrency: "PLN",
    provider: "catalog",
    latestPrice: 320,
    latestPriceDate: "2026-09-03",
    createdAt: NOW,
  };
  const openingTrade = buildOperationsFromLegacyState("portfolio", {
    assets: [short],
    sales: [],
    realizedAdjustments: [],
  })[0];
  assert.equal(openingTrade.operationType, "SELL");
  assert.equal(openingTrade.metadata.cashImpact, false);
  assert.equal(openingTrade.metadata.positionEffect, "OPEN");
  assert.equal(getAssetProfitLossPln(short, { PLN: 1 }), 26);
  assert.equal(getAssetMarketValuePln(short, { PLN: 1 }), 30);

  const openFee = buildCashOperation({
    id: "open-fee",
    portfolioId: "portfolio",
    accountId: cashAccountId,
    operationType: "FEE",
    amount: 4,
    currency: "PLN",
    date: "2026-09-01",
    notes: "Opening commission",
    createdAt: NOW,
  });
  const openBalances = calculateCashBalances([deposit, openFee, openingTrade], [account]);
  const openSummary = getPortfolioSummary([short], [], [], { PLN: 1 }, "PLN", openBalances);
  assert.equal(openSummary.totalValuePln, 10_026);

  const group = getGroupedPortfolioAssets([short], { PLN: 1 })[0];
  const closed = applySaleToPortfolio({
    assets: [short],
    group,
    draft: {
      groupKey: group.key,
      name: group.name,
      symbol: group.symbol,
      kind: group.kind,
      purchaseCurrency: "PLN",
      marketCurrency: "PLN",
      provider: "catalog",
      maxQuantity: 1,
      quantity: 1,
      quantityInput: "1",
      salePrice: 320,
      salePriceInput: "320",
      saleDate: "2026-09-03",
      feePln: 2,
    },
    fxRates: { PLN: 1 },
  });
  assert.equal(closed.sale.realizedProfitLossPln, 24);
  const closingTrade = buildOperationsFromLegacyState("portfolio", {
    assets: closed.assets,
    sales: [closed.sale],
    realizedAdjustments: [],
  }).find((operation) => operation.operationType === "BUY");
  assert.ok(closingTrade);
  assert.equal(closingTrade.metadata.cashImpact, false);
  assert.equal(closingTrade.metadata.positionEffect, "CLOSE");
  const realizedGrossPnl = closed.sale.realizedProfitLossPln +
    closed.sale.allocations.reduce((total, allocation) => total + allocation.allocatedBuyFeePln, 0) +
    closed.sale.feePln;
  assert.equal(realizedGrossPnl, 30);
  const realizedPnl = buildCashOperation({
    id: "close-pnl",
    portfolioId: "portfolio",
    accountId: cashAccountId,
    operationType: "CUSTOM",
    amount: realizedGrossPnl,
    currency: "PLN",
    date: "2026-09-03",
    notes: "Realized short result",
    createdAt: NOW,
  });
  const closeFee = buildCashOperation({
    id: "close-fee",
    portfolioId: "portfolio",
    accountId: cashAccountId,
    operationType: "FEE",
    amount: 2,
    currency: "PLN",
    date: "2026-09-03",
    notes: "Closing commission",
    createdAt: NOW,
  });
  const finalBalances = calculateCashBalances(
    [deposit, openFee, openingTrade, closingTrade, realizedPnl, closeFee],
    [account]
  );
  const finalSummary = getPortfolioSummary([], [closed.sale], [], { PLN: 1 }, "PLN", finalBalances);
  assert.equal(finalSummary.totalValuePln, 10_024);
  assert.equal(finalSummary.realizedProfitLossPln, 24);
});

test("CFD long applies signed mark-to-market with contract multiplier and commission", () => {
  const cfd = assetFromOperation(
    {
      rowNumber: 1,
      name: "Oil CFD",
      symbol: "OIL",
      kind: "stock",
      instrumentType: "CFD",
      positionDirection: "LONG",
      contractMultiplier: 10,
      date: "2026-09-01",
      quantity: 2,
      price: 70,
      currency: "USD",
      feePln: 8,
      provider: "catalog",
    },
    { latestPrice: 75 }
  );

  assert.equal(getAssetMarketValuePln(cfd, FX), 400);
  assert.equal(getAssetProfitLossPln(cfd, FX), 392);
});

test("manual CFD and short lots stay separate from the underlying long and from each other", () => {
  const identity = {
    ticker: "VWCE",
    provider: "eodhd",
    exchange: "XETRA",
    exchangeCode: "GR",
    currency: "EUR",
    instrumentType: "ETF",
  };
  const regularEtfKey = getPortfolioAssetGroupKey({
    kind: "etf",
    symbol: "VWCE.DE",
    instrumentIdentity: identity,
    instrumentType: "ETF",
    positionDirection: "LONG",
  });
  const etfCfdKey = getPortfolioAssetGroupKey({
    kind: "etf",
    symbol: "VWCE.DE",
    instrumentIdentity: identity,
    instrumentType: "CFD",
    positionDirection: "LONG",
  });
  const shortKey = getPortfolioAssetGroupKey({
    kind: "etf",
    symbol: "VWCE.DE",
    instrumentIdentity: identity,
    instrumentType: "ETF",
    positionDirection: "SHORT",
  });

  assert.notEqual(regularEtfKey, etfCfdKey);
  assert.notEqual(regularEtfKey, shortKey);
  assert.notEqual(etfCfdKey, shortKey);
});

test("CFD long applies the contract multiplier and fees", () => {
  const result = parseBrokerOperationsCsv(
    [
      "Type;Date;Symbol;Name;Quantity;Price;Currency;Value;Asset Type;Direction;Position Effect;Contract Size;Fee",
      "Open Long;01.09.2026;OIL.CFD;Oil CFD;2;70;USD;140;CFD;LONG;OPEN;10;4",
      "Close Long;02.09.2026;OIL.CFD;Oil CFD;2;75;USD;150;CFD;LONG;CLOSE;10;4",
    ].join("\n"),
    "generic"
  );
  const closed = closePosition(
    [assetFromOperation(result.operations[0])],
    result.operations[1]
  );

  assert.equal(closed.assets.length, 0);
  assert.equal(closed.sale.instrumentType, "CFD");
  assert.equal(closed.sale.positionDirection, "LONG");
  assert.equal(closed.sale.realizedProfitLossPln, 392);
});

test("short close can realize a loss larger than the opening notional", () => {
  const openingAsset = {
    id: "short-loss-lot",
    name: "Short loss test",
    symbol: "LOSS",
    kind: "stock",
    positionDirection: "SHORT",
    purchaseDate: "2026-09-01",
    quantity: 2,
    purchasePrice: 100,
    purchaseCurrency: "PLN",
    purchasePriceCurrency: "PLN",
    purchaseFxRateToPln: 1,
    feePln: 0,
    marketCurrency: "PLN",
    provider: "catalog",
    createdAt: NOW,
  };
  const group = getGroupedPortfolioAssets([openingAsset], { PLN: 1 })[0];

  const result = applySaleToPortfolio({
    assets: [openingAsset],
    group,
    draft: {
      groupKey: group.key,
      name: group.name,
      symbol: group.symbol,
      kind: group.kind,
      purchaseCurrency: "PLN",
      marketCurrency: "PLN",
      provider: "catalog",
      maxQuantity: 2,
      quantity: 2,
      quantityInput: "2",
      salePrice: 210,
      salePriceInput: "210",
      saleDate: "2026-09-03",
      feePln: 5,
    },
    fxRates: { PLN: 1 },
  });

  assert.equal(result.assets.length, 0);
  assert.equal(result.sale.realizedProfitLossPln, -225);
});
