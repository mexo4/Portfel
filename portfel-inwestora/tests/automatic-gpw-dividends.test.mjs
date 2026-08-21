import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAutomaticGpwDividends,
  AUTOMATIC_DIVIDEND_NOTE,
  getHistoricalInstrumentQuantity,
  projectDividendEventsForPortfolios,
} from "../src/lib/automatic-gpw-dividends.ts";
import { buildDividendOperation, getPortfolioDividends } from "../src/lib/dividend-engine.ts";

const buildPortfolio = ({
  id = "portfolio-a",
  ticker = "KPL.PL",
  operations = [],
} = {}) => {
  const instrumentId = `${id}:instrument:stock:${ticker}`;
  const accountId = `${id}:account:investment:default`;
  const createdAt = "2026-01-01T00:00:00.000Z";
  return {
    id,
    name: id,
    assets: [],
    sales: [],
    realizedAdjustments: [],
    accounts: [{
      id: accountId,
      portfolioId: id,
      name: "Konto inwestycyjne",
      kind: "investment",
      currency: "PLN",
      isDefault: true,
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    }],
    instruments: [{
      id: instrumentId,
      portfolioId: id,
      type: "STOCK",
      assetKind: "stock",
      symbol: ticker,
      name: ticker === "KTY.PL" ? "Grupa Kęty" : "Kino Polska TV",
      marketCurrency: "PLN",
      provider: "stooq",
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    }],
    operations: operations.map((operation, index) => ({
      id: operation.id ?? `${id}:operation:${index}`,
      portfolioId: id,
      accountId,
      assetId: instrumentId,
      operationType: operation.operationType,
      quantity: operation.quantity,
      price: operation.price ?? 10,
      currency: "PLN",
      exchangeRate: 1,
      fee: 0,
      tax: 0,
      amount: (operation.quantity ?? 0) * (operation.price ?? 10),
      date: operation.date,
      notes: operation.notes ?? "",
      metadata: operation.metadata ?? {},
      createdAt,
      updatedAt: createdAt,
    })),
    tags: [],
    tagAssignments: [],
    benchmarks: [],
    metadata: {},
    createdAt,
    updatedAt: createdAt,
  };
};

const kinoEvent = {
  id: "event-kpl-2025",
  instrumentId: "corporate-event-instrument:gpw:ticker:KPL",
  ticker: "KPL",
  companyName: "Kino Polska TV",
  eventType: "UPCOMING_DIVIDEND",
  eventDate: "2026-08-21",
  fiscalYear: 2025,
  dividendPerShare: 1.18,
  dividendCurrency: "PLN",
  recordDate: "2026-08-21",
  paymentDate: "2026-08-28",
  status: "CONFIRMED",
  active: true,
  discoveredAt: "2026-06-29T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:00.000Z",
  source: {
    sourceType: "ISSUER_IR",
    sourceUrl: "https://relacjeinwestorskie.kinopolska.pl/kalendarium/",
  },
};

const toBook = (...portfolios) => ({
  schemaVersion: 2,
  portfolios,
  activePortfolioId: portfolios[0].id,
});

test("historical dividend quantity ignores a sale after the record date", () => {
  const portfolio = buildPortfolio({
    operations: [
      { operationType: "BUY", quantity: 20, date: "2026-08-01" },
      { operationType: "SELL", quantity: 5, date: "2026-08-22" },
      { operationType: "BUY", quantity: 2, date: "2026-08-23" },
    ],
  });
  const instrumentId = portfolio.instruments[0].id;

  assert.equal(getHistoricalInstrumentQuantity(portfolio, instrumentId, "2026-08-21"), 20);
  assert.equal(getHistoricalInstrumentQuantity(portfolio, instrumentId, "2026-08-31"), 17);
});

test("historical dividend quantity includes trades before the record date", () => {
  const portfolio = buildPortfolio({
    operations: [
      { operationType: "BUY", quantity: 20, date: "2026-07-01" },
      { operationType: "SELL", quantity: 4, date: "2026-08-10" },
      { operationType: "BUY", quantity: 3, date: "2026-08-20" },
    ],
  });

  assert.equal(
    getHistoricalInstrumentQuantity(portfolio, portfolio.instruments[0].id, "2026-08-21"),
    19
  );
});

test("projects gross, 19 percent Polish tax and net from the entitlement quantity", () => {
  const portfolio = buildPortfolio({
    operations: [{ operationType: "BUY", quantity: 10, date: "2026-08-01" }],
  });
  const [projection] = projectDividendEventsForPortfolios({
    events: [kinoEvent],
    portfolios: [portfolio],
    today: "2026-08-22",
  });

  assert.deepEqual(
    {
      quantity: projection.eligibleQuantity,
      status: projection.eligibilityStatus,
      gross: projection.estimatedGrossAmount,
      tax: projection.estimatedTaxAmount,
      net: projection.estimatedNetAmount,
    },
    { quantity: 10, status: "ENTITLEMENT_CONFIRMED", gross: 11.8, tax: 2.24, net: 9.56 }
  );
});

test("uses current quantity only as a clearly marked estimate before the record date", () => {
  const portfolio = buildPortfolio({
    operations: [{ operationType: "BUY", quantity: 7, date: "2026-08-01" }],
  });
  const [projection] = projectDividendEventsForPortfolios({
    events: [kinoEvent],
    portfolios: [portfolio],
    today: "2026-08-20",
  });

  assert.equal(projection.eligibleQuantity, 7);
  assert.equal(projection.eligibilityStatus, "CURRENT_ESTIMATE");
});

test("does not post before payment and posts exactly once on payment date", () => {
  const portfolio = buildPortfolio({
    operations: [{ operationType: "BUY", quantity: 10, date: "2026-08-01" }],
  });
  const before = applyAutomaticGpwDividends({
    portfolioBook: toBook(portfolio),
    events: [kinoEvent],
    today: "2026-08-27",
  });
  assert.equal(before.addedCount, 0);

  const paid = applyAutomaticGpwDividends({
    portfolioBook: before.portfolioBook,
    events: [kinoEvent],
    today: "2026-08-28",
    createdAt: "2026-08-28T08:00:00.000Z",
  });
  assert.equal(paid.addedCount, 1);

  const repeated = applyAutomaticGpwDividends({
    portfolioBook: paid.portfolioBook,
    events: [kinoEvent],
    today: "2026-08-28",
  });
  assert.equal(repeated.addedCount, 0);
  assert.equal(paid.portfolioBook.portfolios[0].operations.length, 2);

  const dividend = getPortfolioDividends(paid.portfolioBook.portfolios[0], { PLN: 1 })[0];
  assert.equal(dividend.isAutomatic, true);
  assert.equal(dividend.notes, AUTOMATIC_DIVIDEND_NOTE);
  assert.equal(dividend.grossAmount, 11.8);
  assert.equal(dividend.domesticTax, 2.24);
  assert.equal(dividend.netAmount, 9.56);
});

test("an existing matching manual payment prevents an automatic duplicate", () => {
  const base = buildPortfolio({
    operations: [{ operationType: "BUY", quantity: 10, date: "2026-08-01" }],
  });
  const manual = buildDividendOperation({
    id: "manual-kpl-dividend",
    portfolioId: base.id,
    accountId: base.accounts[0].id,
    instrumentId: base.instruments[0].id,
    quantity: 10,
    dividendPerShare: 1.18,
    currency: "PLN",
    exchangeRate: 1,
    withholdingTax: 0,
    domesticTax: 2.24,
    exDividendDate: "",
    recordDate: "2026-08-21",
    paymentDate: "2026-08-28",
    country: "PL",
    notes: "Wpis ręczny",
  });
  base.operations.push(manual);

  const result = applyAutomaticGpwDividends({
    portfolioBook: toBook(base),
    events: [kinoEvent],
    today: "2026-08-28",
  });

  assert.equal(result.addedCount, 0);
  assert.equal(result.manualMatchesCount, 1);
  assert.equal(result.portfolioBook.portfolios[0].operations.length, 2);
});

test("posts separate installments and does not alter a posted operation after a source change", () => {
  const portfolio = buildPortfolio({
    id: "portfolio-kty",
    ticker: "KTY.PL",
    operations: [{ operationType: "BUY", quantity: 2, date: "2026-08-01" }],
  });
  const installments = [
    { ...kinoEvent, id: "kty-installment-1", ticker: "KTY", companyName: "Grupa Kęty", recordDate: "2026-08-19", paymentDate: "2026-09-03", dividendPerShare: 16.33, dividendInstallment: 1 },
    { ...kinoEvent, id: "kty-installment-2", ticker: "KTY", companyName: "Grupa Kęty", recordDate: "2026-08-19", paymentDate: "2026-11-04", dividendPerShare: 32.64, dividendInstallment: 2 },
  ];
  const first = applyAutomaticGpwDividends({
    portfolioBook: toBook(portfolio),
    events: installments,
    today: "2026-11-04",
  });
  assert.equal(first.addedCount, 2);

  const changedAfterPosting = applyAutomaticGpwDividends({
    portfolioBook: first.portfolioBook,
    events: [{ ...installments[0], paymentDate: "2026-09-10", dividendPerShare: 17 }],
    today: "2026-11-04",
  });
  assert.equal(changedAfterPosting.addedCount, 0);
  const dividends = getPortfolioDividends(changedAfterPosting.portfolioBook.portfolios[0], { PLN: 1 });
  assert.deepEqual(dividends.map((item) => item.dividendPerShare).sort((a, b) => a - b), [16.33, 32.64]);
});

test("posts the same shared event independently to two real portfolios and aggregates one forecast", () => {
  const first = buildPortfolio({
    id: "portfolio-a",
    operations: [{ operationType: "BUY", quantity: 10, date: "2026-08-01" }],
  });
  const second = buildPortfolio({
    id: "portfolio-b",
    operations: [{ operationType: "BUY", quantity: 5, date: "2026-08-02" }],
  });
  const projection = projectDividendEventsForPortfolios({
    events: [kinoEvent],
    portfolios: [first, second],
    today: "2026-08-22",
  });
  assert.equal(projection.length, 1);
  assert.equal(projection[0].eligibleQuantity, 15);

  const result = applyAutomaticGpwDividends({
    portfolioBook: toBook(first, second),
    events: [kinoEvent],
    today: "2026-08-28",
  });
  assert.equal(result.addedCount, 2);
  assert.equal(result.portfolioBook.portfolios[0].operations.filter((operation) => operation.operationType === "DIVIDEND").length, 1);
  assert.equal(result.portfolioBook.portfolios[1].operations.filter((operation) => operation.operationType === "DIVIDEND").length, 1);
});

test("LPP final payment posts only the remaining amount after its paid advance", () => {
  const portfolio = buildPortfolio({
    ticker: "LPP.PL",
    operations: [{ operationType: "BUY", quantity: 0.03, date: "2026-09-01" }],
  });
  const event = { ...kinoEvent, id: "lpp-final-2026", ticker: "LPP", companyName: "LPP", dividendPerShare: 500, dividendTotalPerShare: 900, dividendAdvancePerShare: 400, recordDate: "2026-10-09", paymentDate: "2026-10-30" };
  const [projection] = projectDividendEventsForPortfolios({ events: [event], portfolios: [portfolio], today: "2026-10-10" });
  assert.deepEqual({ gross: projection.estimatedGrossAmount, tax: projection.estimatedTaxAmount, net: projection.estimatedNetAmount }, { gross: 15, tax: 2.85, net: 12.15 });
  const result = applyAutomaticGpwDividends({ portfolioBook: toBook(portfolio), events: [event], today: "2026-10-30" });
  const [dividend] = getPortfolioDividends(result.portfolioBook.portfolios[0], { PLN: 1 });
  assert.equal(result.addedCount, 1);
  assert.equal(dividend.dividendPerShare, 500);
  assert.equal(dividend.grossAmount, 15);
});

test("never auto-posts a proposal or an event without a record date", () => {
  const portfolio = buildPortfolio({
    operations: [{ operationType: "BUY", quantity: 10, date: "2026-08-01" }],
  });
  const proposal = { ...kinoEvent, status: "PROPOSED" };
  const missingRecordDate = { ...kinoEvent, id: "missing-record", recordDate: undefined };

  const result = applyAutomaticGpwDividends({
    portfolioBook: toBook(portfolio),
    events: [proposal, missingRecordDate],
    today: "2026-08-28",
  });
  assert.equal(result.addedCount, 0);
});
