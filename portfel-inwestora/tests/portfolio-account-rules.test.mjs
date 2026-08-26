import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNUAL_CONTRIBUTION_RULES,
  calculateOkiTax,
  calculateOkiRateFromNbpReferenceRate,
  calculatePolishDividendTax,
  classifyOkiAsset,
  estimateIkzeTaxBenefit,
  getAnnualContributionSummary,
  getWithdrawalTaxEstimate,
} from "../src/lib/portfolio-account-rules.ts";
import { applyAutomaticGpwDividends } from "../src/lib/automatic-gpw-dividends.ts";
import { buildCashOperation } from "../src/lib/cash-engine.ts";
import {
  buildAutomaticBondCouponAdjustments,
  normalizePortfolioBook,
} from "../src/lib/portfolio-state.ts";

const NOW = "2026-01-01T00:00:00.000Z";

const buildPortfolio = ({
  id,
  accountType,
  operations = [],
  paymentYear = 2027,
}) => {
  const accountId = `${id}:account:investment:default`;
  const instrumentId = `${id}:instrument:stock:DNP.PL`;
  return {
    id,
    name: id,
    accountType,
    accountConfiguration: accountType === "IKZE"
      ? { ikzeLimitVariant: "STANDARD", ikzeTaxEstimateRate: 0.12 }
      : {},
    baseCurrency: "PLN",
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
      createdAt: NOW,
      updatedAt: NOW,
    }],
    instruments: [{
      id: instrumentId,
      portfolioId: id,
      type: "STOCK",
      assetKind: "stock",
      symbol: "DNP.PL",
      name: "Dino Polska",
      marketCurrency: "PLN",
      provider: "stooq",
      metadata: {},
      createdAt: NOW,
      updatedAt: NOW,
    }],
    operations: operations.map((operation, index) => ({
      id: operation.id ?? `${id}:operation:${index}`,
      portfolioId: id,
      accountId,
      assetId: operation.assetId ?? null,
      operationType: operation.operationType,
      quantity: operation.quantity ?? 0,
      price: operation.price ?? 0,
      currency: operation.currency ?? "PLN",
      exchangeRate: operation.exchangeRate,
      fee: 0,
      tax: 0,
      amount: operation.amount,
      date: operation.date,
      notes: "",
      metadata: operation.metadata ?? {},
      createdAt: NOW,
      updatedAt: NOW,
    })),
    tags: [],
    tagAssignments: [],
    benchmarks: [],
    metadata: { paymentYear },
    createdAt: NOW,
    updatedAt: NOW,
  };
};

test("official annual IKE and IKZE limits are centralized for 2026", () => {
  assert.deepEqual(ANNUAL_CONTRIBUTION_RULES[2026], {
    ike: 28_260,
    ikze: 11_304,
    ikzeBusiness: 16_956,
  });
});

test("legacy portfolios become STANDARD without changing economic history", () => {
  const legacy = buildPortfolio({
    id: "legacy",
    accountType: undefined,
    operations: [{ operationType: "DEPOSIT", amount: 1_000, date: "2026-01-02" }],
  });
  delete legacy.accountType;
  delete legacy.accountConfiguration;
  const originalOperation = legacy.operations[0];

  const [normalized] = normalizePortfolioBook({
    schemaVersion: 2,
    activePortfolioId: legacy.id,
    portfolios: [legacy],
  }).portfolios;

  assert.equal(normalized.accountType, "STANDARD");
  assert.deepEqual(normalized.assets, legacy.assets);
  assert.deepEqual(normalized.sales, legacy.sales);
  assert.deepEqual(normalized.realizedAdjustments, legacy.realizedAdjustments);
  assert.deepEqual(
    {
      type: normalized.operations[0].operationType,
      amount: normalized.operations[0].amount,
      currency: normalized.operations[0].currency,
      date: normalized.operations[0].date,
      tax: normalized.operations[0].tax,
      fee: normalized.operations[0].fee,
    },
    {
      type: originalOperation.operationType,
      amount: originalOperation.amount,
      currency: originalOperation.currency,
      date: originalOperation.date,
      tax: originalOperation.tax,
      fee: originalOperation.fee,
    }
  );
});

test("changing the account type does not rewrite recorded historical dividend taxes", () => {
  const portfolio = buildPortfolio({
    id: "historical-dividend",
    accountType: "IKE",
    operations: [{
      operationType: "DIVIDEND",
      quantity: 10,
      price: 5,
      amount: 40,
      date: "2025-06-01",
      metadata: {
        grossAmount: 50,
        domesticTax: 5,
        withholdingTax: 5,
        netAmount: 40,
      },
    }],
  });
  portfolio.operations[0].tax = 10;
  const [normalized] = normalizePortfolioBook({
    schemaVersion: 2,
    activePortfolioId: portfolio.id,
    portfolios: [portfolio],
  }).portfolios;
  const dividend = normalized.operations.find((operation) => operation.operationType === "DIVIDEND");
  assert.equal(dividend.tax, 10);
  assert.equal(dividend.metadata.domesticTax, 5);
  assert.equal(dividend.metadata.withholdingTax, 5);
  assert.equal(dividend.metadata.netAmount, 40);
});

test("IKE limit counts contributions but excludes initial balances and transfers", () => {
  const portfolio = buildPortfolio({
    id: "ike-limit",
    accountType: "IKE",
    operations: [
      { operationType: "DEPOSIT", amount: 10_000, date: "2026-01-02" },
      { operationType: "DEPOSIT", amount: 2_000, date: "2026-02-02", metadata: { accountFlowKind: "TRANSFER_IN" } },
      { operationType: "DEPOSIT", amount: 500, date: "2026-02-03", metadata: { cashEntryKind: "INITIAL_BALANCE" } },
      { operationType: "DIVIDEND", amount: 100, date: "2026-03-01" },
    ],
  });
  const summary = getAnnualContributionSummary({ portfolio, year: 2026 });
  assert.equal(summary.contributedPln, 10_000);
  assert.equal(summary.limitPln, 28_260);
  assert.equal(summary.remainingPln, 18_260);
});

test("limit summary handles exact, below, above, deleted and missing FX cases", () => {
  const exact = buildPortfolio({
    id: "ike-exact",
    accountType: "IKE",
    operations: [{ operationType: "DEPOSIT", amount: 28_260, date: "2026-01-02" }],
  });
  assert.equal(getAnnualContributionSummary({ portfolio: exact, year: 2026 }).exceededByPln, 0);

  exact.operations[0].amount = 28_259.99;
  assert.equal(getAnnualContributionSummary({ portfolio: exact, year: 2026 }).remainingPln, 0.01);
  exact.operations[0].amount = 28_260.01;
  assert.equal(getAnnualContributionSummary({ portfolio: exact, year: 2026 }).exceededByPln, 0.01);
  exact.operations = [];
  assert.equal(getAnnualContributionSummary({ portfolio: exact, year: 2026 }).contributedPln, 0);

  const fx = buildPortfolio({
    id: "ike-fx",
    accountType: "IKE",
    operations: [{ operationType: "DEPOSIT", amount: 100, currency: "EUR", date: "2026-01-02" }],
  });
  assert.equal(getAnnualContributionSummary({ portfolio: fx, year: 2026 }).isComplete, false);
  fx.operations[0].metadata.amountPlnSnapshot = 430;
  assert.equal(getAnnualContributionSummary({ portfolio: fx, year: 2026 }).contributedPln, 430);
});

test("IKZE business limit and tax benefit remain explicit estimates", () => {
  const portfolio = buildPortfolio({
    id: "ikze-business",
    accountType: "IKZE",
    operations: [{ operationType: "DEPOSIT", amount: 12_000, date: "2026-01-02" }],
  });
  portfolio.accountConfiguration = {
    ikzeLimitVariant: "BUSINESS",
    ikzeTaxEstimateRate: 0.12,
  };
  const summary = getAnnualContributionSummary({ portfolio, year: 2026 });
  assert.equal(summary.limitPln, 16_956);
  assert.equal(estimateIkzeTaxBenefit({ contributionSummary: summary, taxRate: 0.12 }), 1_440);
});

test("domestic dividend treatment differs per real portfolio and keeps one posting each", () => {
  const portfolios = ["STANDARD", "IKE", "IKZE", "OKI"].map((accountType) => {
    const portfolio = buildPortfolio({ id: `portfolio-${accountType}`, accountType });
    portfolio.operations.push({
      id: `buy-${accountType}`,
      portfolioId: portfolio.id,
      accountId: portfolio.accounts[0].id,
      assetId: portfolio.instruments[0].id,
      operationType: "BUY",
      quantity: 10,
      price: 10,
      currency: "PLN",
      exchangeRate: 1,
      fee: 0,
      tax: 0,
      amount: 100,
      date: "2027-01-10",
      notes: "",
      metadata: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    return portfolio;
  });
  const event = {
    id: "dino-dividend-2027",
    instrumentId: "gpw:DNP",
    ticker: "DNP",
    companyName: "Dino Polska",
    eventType: "UPCOMING_DIVIDEND",
    eventDate: "2027-06-01",
    fiscalYear: 2026,
    dividendPerShare: 10,
    dividendCurrency: "PLN",
    recordDate: "2027-06-01",
    paymentDate: "2027-06-15",
    status: "CONFIRMED",
    active: true,
    discoveredAt: NOW,
    updatedAt: NOW,
  };
  const result = applyAutomaticGpwDividends({
    portfolioBook: { schemaVersion: 2, activePortfolioId: portfolios[0].id, portfolios },
    events: [event],
    today: "2027-06-15",
  });

  assert.equal(result.addedCount, 4);
  assert.deepEqual(
    result.portfolioBook.portfolios.map((portfolio) => ({
      type: portfolio.accountType,
      tax: portfolio.operations.find((operation) => operation.operationType === "DIVIDEND")?.tax,
    })),
    [
      { type: "STANDARD", tax: 19 },
      { type: "IKE", tax: 0 },
      { type: "IKZE", tax: 0 },
      { type: "OKI", tax: 0 },
    ]
  );
});

test("automatic paid-out bond coupons use the real portfolio account tax treatment", () => {
  const asset = {
    id: "coi-lot",
    kind: "bond",
    quantity: 10,
    purchaseDate: "2026-01-15",
    bondMeta: {
      code: "COI0129",
      type: "COI",
      yearsToMaturity: 4,
      issueMonth: 1,
      issueYear: 2026,
      redemptionMonth: 1,
      redemptionYear: 2030,
      nominalValue: 100,
      salePrice: 100,
      firstYearRate: 5,
      marginRate: 1.5,
      earlyRedemptionFee: 2,
      couponMode: "paid-out",
      interestPaymentDescription: "Corocznie",
      isFamilyOnly: false,
      resolvedAt: NOW,
    },
  };

  const standard = buildAutomaticBondCouponAdjustments([asset], [], "STANDARD");
  const ike = buildAutomaticBondCouponAdjustments([asset], [], "IKE");
  const ikze = buildAutomaticBondCouponAdjustments([asset], [], "IKZE");
  const oki = buildAutomaticBondCouponAdjustments([asset], [], "OKI");

  assert.equal(standard.find((coupon) => coupon.date === "2027-01-15").amount, 40.5);
  assert.equal(ike.find((coupon) => coupon.date === "2027-01-15").amount, 50);
  assert.equal(ikze.find((coupon) => coupon.date === "2027-01-15").amount, 50);
  assert.equal(oki.find((coupon) => coupon.date === "2027-01-15").amount, 50);
});

test("OKI does not apply before 2027", () => {
  assert.equal(calculateOkiTax({ year: 2026, accounts: [] }).status, "NOT_EFFECTIVE");
  assert.equal(calculatePolishDividendTax({
    grossAmount: 100,
    accountType: "OKI",
    paymentDate: "2026-12-31",
  }).amount, 19);
});

test("OKI annual-rate mechanism rounds down and respects the statutory floor", () => {
  assert.equal(calculateOkiRateFromNbpReferenceRate(4.5), 0.0085);
  assert.equal(calculateOkiRateFromNbpReferenceRate(0), 0.001);
  assert.equal(calculateOkiRateFromNbpReferenceRate(Number.NaN), null);
});

test("OKI 2027 aggregates multiple accounts and caps both exemptions at PLN 100,000", () => {
  const result = calculateOkiTax({
    year: 2027,
    accounts: [
      {
        portfolioId: "oki-a",
        daysHeld: 2,
        dailyValuations: [
          { date: "2027-01-01", savingsPln: 20_000, investmentPln: 40_000, nonExemptPln: 0 },
          { date: "2027-01-02", savingsPln: 20_000, investmentPln: 40_000, nonExemptPln: 0 },
        ],
      },
      {
        portfolioId: "oki-b",
        daysHeld: 2,
        dailyValuations: [
          { date: "2027-01-01", savingsPln: 10_000, investmentPln: 60_000, nonExemptPln: 0 },
          { date: "2027-01-02", savingsPln: 10_000, investmentPln: 60_000, nonExemptPln: 0 },
        ],
      },
    ],
  });
  assert.equal(result.status, "EXACT");
  assert.equal(result.averageSavingsPln, 30_000);
  assert.equal(result.averageInvestmentPln, 100_000);
  assert.equal(result.exemptPln, 100_000);
  assert.equal(result.taxableBasePln, 30_000);
  assert.equal(result.taxRate, 0.0085);
  assert.equal(result.taxPln, 255);
});

test("OKI refuses an exact result without complete daily categorized history", () => {
  const result = calculateOkiTax({
    year: 2027,
    accounts: [{
      portfolioId: "oki",
      daysHeld: 2,
      dailyValuations: [
        { date: "2027-01-01", savingsPln: 0, investmentPln: 110_000, nonExemptPln: 0 },
      ],
    }],
  });
  assert.equal(result.status, "INSUFFICIENT_HISTORY");
  assert.equal(result.taxPln, null);
});

test("OKI classifies only supported treasury savings bonds without guessing stocks or ETFs", () => {
  assert.equal(classifyOkiAsset({
    assetKind: "bond",
    marketCurrency: "PLN",
    metadata: { treasuryBondType: "EDO" },
  }).group, "SAVINGS");
  assert.equal(classifyOkiAsset({
    assetKind: "stock",
    marketCurrency: "PLN",
    metadata: {},
  }).group, null);
});

test("withdrawal rules distinguish qualified withdrawals, early returns and transfers", () => {
  assert.deepEqual(
    getWithdrawalTaxEstimate({
      accountType: "IKZE",
      flowKind: "QUALIFIED_WITHDRAWAL",
      amountPln: 10_000,
      date: "2035-01-01",
    }).estimatedTaxPln,
    1_000
  );
  assert.equal(getWithdrawalTaxEstimate({
    accountType: "IKE",
    flowKind: "EARLY_RETURN",
    amountPln: 10_000,
    date: "2026-01-01",
  }).status, "ESTIMATE_UNAVAILABLE");
  assert.equal(getWithdrawalTaxEstimate({
    accountType: "IKE",
    flowKind: "TRANSFER_OUT",
    amountPln: 10_000,
    date: "2026-01-01",
  }).estimatedTaxPln, 0);
});

test("cash transfer metadata preserves ledger semantics and does not consume the IKE limit", () => {
  const portfolio = buildPortfolio({ id: "ike-transfer", accountType: "IKE" });
  const transfer = buildCashOperation({
    id: "incoming-transfer",
    portfolioId: portfolio.id,
    accountId: portfolio.accounts[0].id,
    operationType: "DEPOSIT",
    amount: 100_000,
    currency: "PLN",
    date: "2026-04-01",
    notes: "Wypłata transferowa",
    accountFlowKind: "TRANSFER_IN",
    amountPlnSnapshot: 100_000,
  });
  portfolio.operations.push(transfer);
  assert.equal(transfer.metadata.accountFlowKind, "TRANSFER_IN");
  assert.equal(getAnnualContributionSummary({ portfolio, year: 2026 }).contributedPln, 0);
});
