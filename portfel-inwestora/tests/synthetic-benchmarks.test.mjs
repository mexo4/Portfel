import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  DEPOSIT_BENCHMARK,
  INFLATION_BENCHMARK,
  buildDepositIndexPoints,
  buildInflationIndexPoints,
  combineMixSeries,
  createMixBenchmark,
  isMixBenchmark,
  parseEurostatMonthlySeries,
} = await import("../src/lib/synthetic-benchmarks.ts");
const { normalizePortfolioBenchmarks } = await import("../src/lib/operation-engine.ts");

const etf = { id: "etf:VWCE.XETRA", name: "Vanguard FTSE All-World", symbol: "VWCE", kind: "etf", marketCurrency: "EUR", provider: "eodhd", providerId: "VWCE.XETRA" };

test("inflation steps once a month and keeps the latest published month", () => {
  const monthly = [{ month: "2026-08", index: 159.2 }, { month: "2026-09", index: 160.24 }, { month: "2026-10", index: 160.23 }];
  const points = buildInflationIndexPoints(monthly, ["2026-07-31", "2026-08-15", "2026-09-30", "2026-10-01", "2026-11-25"]);

  assert.deepEqual(points, [
    { date: "2026-08-15", close: 159.2 },
    { date: "2026-09-30", close: 160.24 },
    { date: "2026-10-01", close: 160.23 },
    { date: "2026-11-25", close: 160.23 },
  ], "no value before the first month, November carries October forward");
});

test("the deposit accrues every calendar day at the rate in force (actual/365)", () => {
  const rates = [{ date: "2026-01-02", annualRate: 0.0365 }, { date: "2026-01-05", annualRate: 0.073 }];
  const points = buildDepositIndexPoints(rates, ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06"]);

  assert.equal(points[0].date, "2026-01-02", "starts on the first published rate");
  assert.equal(points[0].close, 100);
  // 2, 3, 4 January at 3.65% (0.01% a day), then 5 January at 7.30% (0.02% a day).
  assert.equal(points[1].close, Math.round(100 * 1.0001 ** 3 * 1e8) / 1e8);
  assert.equal(points[2].close, Math.round(100 * 1.0001 ** 3 * 1.0002 * 1e8) / 1e8);
});

test("a mix is rebalanced daily: its return is the weighted sum of the parts' returns", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const points = combineMixSeries([
    { weight: 60, points: [{ date: "2026-01-01", pricePln: 100 }, { date: "2026-01-02", pricePln: 110 }, { date: "2026-01-03", pricePln: 99 }] },
    { weight: 40, points: [{ date: "2026-01-01", pricePln: 50 }, { date: "2026-01-02", pricePln: 50 }, { date: "2026-01-03", pricePln: 51 }] },
  ], dates);

  assert.equal(points[0].close, 100);
  assert.equal(points[1].close, 106); // 0.6 × 10% + 0.4 × 0%
  assert.equal(points[2].close, Math.round(106 * (1 + 0.6 * -0.1 + 0.4 * 0.02) * 1e8) / 1e8);
});

test("a mix needs two to five distinct parts whose weights add up to 100%", () => {
  const mix = createMixBenchmark([{ benchmark: etf, weight: 60 }, { benchmark: DEPOSIT_BENCHMARK, weight: 40 }]);

  assert.ok(isMixBenchmark(mix));
  assert.equal(mix.name, "60% Vanguard FTSE All-World + 40% Lokata overnight");
  assert.equal(mix.marketCurrency, "PLN");
  assert.throws(() => createMixBenchmark([{ benchmark: etf, weight: 100 }]), /co najmniej dwóch/);
  assert.throws(() => createMixBenchmark([{ benchmark: etf, weight: 60 }, { benchmark: INFLATION_BENCHMARK, weight: 30 }]), /sumować się do 100% \(teraz 90%\)/);
  assert.throws(() => createMixBenchmark([{ benchmark: etf, weight: 50 }, { benchmark: etf, weight: 50 }]), /tylko raz/);
  assert.throws(() => createMixBenchmark([{ benchmark: mix, weight: 50 }, { benchmark: etf, weight: 50 }]), /innego benchmarku złożonego/);
});

test("a saved mix survives normalisation, a broken one is dropped", () => {
  const mix = createMixBenchmark([{ benchmark: etf, weight: 70 }, { benchmark: INFLATION_BENCHMARK, weight: 30 }]);
  const broken = { ...mix, id: "mexo:mix:broken", components: [{ benchmark: etf, weight: 70 }, { benchmark: INFLATION_BENCHMARK, weight: 20 }] };
  const nested = { ...mix, id: "mexo:mix:nested", components: [{ benchmark: mix, weight: 50 }, { benchmark: etf, weight: 50 }] };
  const normalized = normalizePortfolioBenchmarks([mix, broken, nested, INFLATION_BENCHMARK]);

  assert.deepEqual(normalized.map((item) => item.id), [mix.id, INFLATION_BENCHMARK.id]);
  assert.equal(normalized[0].components.length, 2);
  assert.equal(normalized[0].components[0].benchmark.providerId, "VWCE.XETRA");
  assert.equal(normalized[1].provider, "mexo");
});

test("Eurostat's JSON-stat answer is read as month and index", () => {
  const payload = {
    value: { 0: 159.2, 1: 160.24, 2: 160.23 },
    dimension: { time: { category: { index: { "2026-08": 0, "2026-09": 1, "2026-10": 2 } } } },
  };

  assert.deepEqual(parseEurostatMonthlySeries(payload), [
    { month: "2026-08", index: 159.2 },
    { month: "2026-09", index: 160.24 },
    { month: "2026-10", index: 160.23 },
  ]);
  assert.deepEqual(parseEurostatMonthlySeries({}), []);
});

test("the history engine computes synthetic benchmarks instead of fetching quotes for them", () => {
  const history = readFileSync(new URL("../src/lib/server/portfolio-history.ts", import.meta.url), "utf8");

  assert.match(history, /for \(const benchmark of expandBenchmarks\(benchmarks\)\.filter\(\(item\) => !isSyntheticBenchmark\(item\)\)\)/);
  assert.match(history, /isSyntheticBenchmark\(benchmark\)\s*\? `mexo:\$\{benchmark\.id\}`/);
  assert.match(history, /const syntheticBenchmarkDataPromise = loadSyntheticBenchmarkData\(benchmarks\);/);
});
