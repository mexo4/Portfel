import assert from "node:assert/strict";
import test from "node:test";

const { buildPortfolioStructure, pickWeeklyDates } = await import("../src/lib/portfolio-structure.ts");
const { buildStructureSeries, rangeStartIndex, sharesAt, SERIES_COLORS } = await import("../src/lib/portfolio-structure-series.ts");
const { buildCurrencyExposure, detectEtfCurrencyPreset } = await import("../src/lib/currency-exposure.ts");
const { buildWealthTimeline, getWealthItemValueOn, monthlyDates } = await import("../src/lib/wealth-timeline.ts");
const { normalizeUserProfile } = await import("../src/lib/profile.ts");
const { buildClassLookup } = await import("../src/lib/server/portfolio-structure.ts");

const history = (days, assets) => ({
  warnings: [],
  presentationCurrency: "PLN",
  points: days.map(([date, value]) => ({ date, portfolioValuePln: value, netInvestedPln: value, profitLossPln: 0, timeWeightedReturnPercent: 0 })),
  assetSeries: assets.map(([groupKey, values]) => ({ groupKey, label: groupKey, symbol: groupKey, kind: "stock", points: days.map(([date], index) => ({ date, valuePln: values[index], valuePresentation: values[index] })) })),
});

test("the structure is sampled once a week, on the week's last day", () => {
  // 2026-03-02 is a Monday.
  assert.deepEqual(pickWeeklyDates(["2026-03-02", "2026-03-06", "2026-03-08", "2026-03-09", "2026-03-11"]), ["2026-03-08", "2026-03-11"]);
});

test("instruments of two portfolios merge, and cash is what instruments do not cover", () => {
  const days = [["2026-03-08", 1000], ["2026-03-11", 1200]];
  const structure = buildPortfolioStructure([
    { id: "a", name: "A", history: history(days, [["stock:PKN", [600, 700]]]), classify: () => ({ id: "stock:gpw", label: "Akcje GPW" }) },
    { id: "b", name: "B", history: history([["2026-03-11", 500]], [["stock:PKN", [100]], ["stock:AAPL", [450]]]), classify: (series) => (series.groupKey === "stock:AAPL" ? { id: "stock:foreign", label: "Akcje zagraniczne" } : { id: "stock:gpw", label: "Akcje GPW" }) },
  ], "PLN");
  assert.deepEqual(structure.dates, ["2026-03-08", "2026-03-11"]);
  assert.deepEqual(structure.instruments.find((item) => item.key === "stock:PKN").values, [600, 800]);
  assert.deepEqual(structure.portfolios.map((item) => [item.values, item.cash]), [[[1000, 1200], [400, 500]], [[0, 500], [0, -50]]]);

  const classes = buildStructureSeries(structure, "classes");
  assert.deepEqual(classes.map((item) => [item.id, item.values]), [["stock:gpw", [600, 800]], ["stock:foreign", [0, 450]], ["cash", [400, 450]]]);
  const shares = sharesAt(classes, 1);
  assert.equal(Math.round(shares.get("stock:gpw")), 47);
  assert.deepEqual(buildStructureSeries(structure, "portfolios").map((item) => item.label), ["A", "B"]);
});

test("a negative cash balance takes no share", () => {
  const series = [{ id: "x", label: "x", color: "#000", values: [100] }, { id: "cash", label: "Gotówka", color: "#000", values: [-50] }];
  assert.deepEqual([...sharesAt(series, 0).values()], [100, 0]);
});

test("instrument colours follow the whole history, the tail becomes one group", () => {
  const instruments = Array.from({ length: 10 }, (_, index) => ({ key: `i${index}`, label: `I${index}`, symbol: `I${index}`, classId: "stock:gpw", classLabel: "Akcje GPW", values: [index === 9 ? 1000 : index, 1] }));
  const series = buildStructureSeries({ currency: "PLN", dates: ["2026-01-04", "2026-01-11"], portfolios: [{ id: "a", name: "A", values: [0, 0], cash: [0, 0] }], instruments, warnings: [] }, "instruments");
  assert.equal(series[0].id, "i9");
  assert.equal(series[0].color, SERIES_COLORS[0]);
  assert.equal(series.length, 8);
  assert.match(series.at(-1).label, /Pozostałe walory \(3\)/);
  assert.equal(rangeStartIndex(["2025-01-05", "2025-08-31", "2026-01-11"], "6M"), 1);
});

test("a currency is taken from an ETF's name only when the index leaves no doubt", () => {
  const currencyOf = (name) => detectEtfCurrencyPreset(name)?.weights.map((weight) => `${weight.currency} ${weight.percent}`).join() ?? null;
  assert.equal(currencyOf("iShares Core S&P 500 UCITS ETF"), "USD 100");
  assert.equal(currencyOf("Beta ETF sWIG80TR Portfelowy FIZ"), "PLN 100");
  assert.equal(currencyOf("Xtrackers DAX UCITS ETF"), "EUR 100");
  assert.equal(currencyOf("Amundi MSCI Japan UCITS ETF"), "JPY 100");
  assert.equal(currencyOf("iShares S&P 500 EUR Hedged UCITS ETF"), "EUR 100");
  assert.equal(currencyOf("iShares S&P 500 Hedged ETF"), null);
  assert.equal(currencyOf("Vanguard FTSE All-World UCITS ETF"), null);
  assert.equal(currencyOf("iShares Core MSCI World UCITS ETF"), null);
  assert.equal(currencyOf("iShares STOXX Europe 600"), null);
  assert.equal(currencyOf("Vanguard USD Treasury Bond UCITS ETF"), null);
});

test("exposure looks through ETFs and never guesses a missing split", () => {
  const result = buildCurrencyExposure({
    holdings: [
      { key: "stock:AAPL", name: "Apple", instrumentClass: "stock", currency: "USD", value: 100 },
      { key: "etf:IWDA", name: "iShares MSCI World", instrumentClass: "etf", currency: "EUR", value: 200 },
      { key: "etf:VWCE", name: "Vanguard FTSE All-World", instrumentClass: "etf", currency: "EUR", value: 50 },
      { key: "etf:SPX", name: "SPDR S&P 500", instrumentClass: "etf", currency: "EUR", value: 100 },
      { key: "crypto:BTC", name: "Bitcoin", instrumentClass: "crypto", currency: "USD", value: 30 },
    ],
    cash: [{ currency: "PLN", value: 20 }, { currency: "EUR", value: -5 }],
    profiles: [{ key: "etf:IWDA", weights: [{ currency: "USD", percent: 70 }, { currency: "JPY", percent: 10 }], updatedAt: "" }],
  });
  const byId = Object.fromEntries(result.buckets.map((bucket) => [bucket.id, bucket.value]));
  assert.deepEqual(byId, { USD: 340, PLN: 20, JPY: 20, other: 40, crypto: 30, "etf-unknown": 50 });
  assert.equal(result.total, 500);
  assert.equal(result.negativeCash, -5);
  assert.deepEqual(result.etfs.map((etf) => etf.origin), ["saved", "preset", "missing"]);
});

const item = (overrides) => ({ id: "w", kind: "asset", name: "Mieszkanie", category: "apartment", value: 500_000, currency: "PLN", addedAt: "2026-01-15", description: "", annualChangePercent: 0, createdAt: "", updatedAt: "", ...overrides });

test("a typed-in item counts from its day, at the value then in force", () => {
  const apartment = item({ value: 550_000, valueHistory: [{ date: "2026-01-15", value: 500_000 }, { date: "2026-03-10", value: 550_000 }] });
  assert.equal(getWealthItemValueOn(apartment, "2026-01-01"), 0);
  assert.equal(getWealthItemValueOn(apartment, "2026-02-28"), 500_000);
  assert.equal(getWealthItemValueOn(apartment, "2026-03-31"), 550_000);
  assert.deepEqual(monthlyDates("2026-01-15", "2026-03-20"), ["2026-01-31", "2026-02-28", "2026-03-20"]);
});

test("wealth over time adds accounts and items and takes debts away", () => {
  const loan = item({ id: "l", kind: "liability", category: "loan", value: 12_000, addedAt: "2026-02-01", loan: { principal: 12_000, startDate: "2026-02-01", termMonths: 12, annualRatePercent: 0, installment: "decreasing" } });
  const rows = buildWealthTimeline({
    structure: { dates: ["2026-01-25", "2026-02-22", "2026-03-15"], portfolios: [{ id: "a", name: "A", values: [100, 200, 300], cash: [0, 0, 0] }] },
    wealthItems: [item({ value: 1_000 }), loan],
    fxRates: { PLN: 1 },
    today: "2026-03-20",
  });
  assert.deepEqual(rows.map((row) => [row.date, row.investments, row.property, row.liabilities, row.netWorth]), [
    ["2026-01-31", 100, 1_000, 0, 1_100],
    ["2026-02-28", 200, 1_000, 12_000, -10_800],
    ["2026-03-20", 300, 1_000, 11_000, -9_700],
  ]);
});

test("the profile keeps only usable ETF splits and value histories", () => {
  const profile = normalizeUserProfile({
    wealthItems: [item({ valueHistory: [{ date: "2026-02-01", value: 2 }, { date: "bad", value: 3 }, { date: "2026-01-01", value: -1 }, { date: "2026-01-20", value: 1 }] })],
    etfCurrencyProfiles: [
      { key: "etf:A", weights: [{ currency: "usd", percent: 60 }, { currency: "EUR", percent: 30 }] },
      { key: "etf:B", weights: [{ currency: "USD", percent: 80 }, { currency: "EUR", percent: 40 }] },
      { key: "etf:C", weights: [{ currency: "US$", percent: 10 }] },
      { key: "", weights: [{ currency: "USD", percent: 10 }] },
    ],
  });
  assert.deepEqual(profile.etfCurrencyProfiles.map((entry) => [entry.key, entry.weights.map((weight) => weight.currency)]), [["etf:A", ["USD", "EUR"]]]);
  assert.deepEqual(profile.wealthItems[0].valueHistory, [{ date: "2026-01-20", value: 1 }, { date: "2026-02-01", value: 2 }]);
});

test("classes are judged like on Pozycje, also for holdings sold in full", () => {
  const classOf = buildClassLookup(
    [{ id: "1", name: "Orlen", symbol: "PKN.PL", kind: "stock", provider: "stooq", marketCurrency: "PLN" }],
    [{ name: "Apple", symbol: "AAPL", kind: "stock", provider: "finnhub", marketCurrency: "USD", allocations: [{ lotId: "2", quantity: 1 }] }]
  );
  assert.equal(classOf("stock:PKN", { kind: "stock", label: "Orlen" }).id, "stock:gpw");
  assert.equal(classOf("stock:AAPL", { kind: "stock", label: "Apple" }).id, "stock:foreign");
});
