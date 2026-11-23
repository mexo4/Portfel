import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isRepairableEtfBenchmark,
  repairEtfBenchmark,
} from "../src/lib/benchmark-repair.ts";

const listing = (symbol, exchangeCode, overrides = {}) => ({
  listingId: `${symbol}:${exchangeCode}`,
  symbol,
  name: "VANG FTSE AW USDD",
  kind: "etf",
  marketCurrency: "USD",
  provider: "eodhd",
  source: "api",
  subtitle: `Venue ${exchangeCode}`,
  priceStatus: "unchecked",
  instrumentIdentity: {
    ticker: symbol,
    name: "VANG FTSE AW USDD",
    instrumentType: "ETF",
    exchangeCode,
  },
  ...overrides,
});

const groupOf = (...listings) => [{ id: "group", name: "VANG FTSE AW USDD", instrumentType: "ETF", identity: {}, listings }];

/** The benchmark the old picker saved: a random venue's listing, no price source. */
const deadBenchmark = {
  id: "etf:eodhd:VWRD",
  name: "VANG FTSE AW USDD",
  symbol: "VWRD",
  kind: "etf",
  marketCurrency: "USD",
  provider: "eodhd",
};

const resolvedLondon = (candidate) => ({
  ...candidate,
  provider: "yahoo",
  providerId: "VWRD.L",
  providerPriceSymbol: "VWRD.L",
  priceStatus: "available",
});

test("only an ETF saved without a provider id is repairable", () => {
  assert.equal(isRepairableEtfBenchmark(deadBenchmark), true);
  assert.equal(isRepairableEtfBenchmark({ ...deadBenchmark, providerId: "VWRD.L" }), false);
  assert.equal(isRepairableEtfBenchmark({ ...deadBenchmark, providerId: "  " }), true);
  assert.equal(isRepairableEtfBenchmark({ ...deadBenchmark, kind: "stock" }), false);
  assert.equal(isRepairableEtfBenchmark({ ...deadBenchmark, kind: "crypto" }), false);
});

test("VWRD saved from a venue without prices is rebuilt from the London listing", async () => {
  const resolved = [];
  const repaired = await repairEtfBenchmark({
    benchmark: deadBenchmark,
    searchEtfs: async (query) => {
      assert.equal(query, "VWRD");
      return groupOf(
        listing("VWRD", "B2"),
        listing("VWRD", "B4"),
        listing("VWRD", "LN"),
        listing("VGWL", "GR"),
        listing("VFPEF", "PQ")
      );
    },
    resolvePrice: async (candidate) => {
      resolved.push(candidate.instrumentIdentity.exchangeCode);
      return resolvedLondon(candidate);
    },
  });

  // Only the one workable venue of this ticker was asked about; other tickers never.
  assert.deepEqual(resolved, ["LN"]);
  assert.equal(repaired.id, "etf:yahoo:VWRD.L");
  assert.equal(repaired.providerId, "VWRD.L");
  assert.equal(repaired.provider, "yahoo");
  assert.equal(repaired.symbol, "VWRD");
  assert.equal(repaired.kind, "etf");
  assert.equal(repaired.marketCurrency, "USD");
  assert.equal(repaired.name, "VANG FTSE AW USDD", "the name the user saved is kept");
});

test("the next venue is tried when the first one has no price", async () => {
  const resolved = [];
  const repaired = await repairEtfBenchmark({
    benchmark: { ...deadBenchmark, symbol: "VWRL", id: "etf:eodhd:VWRL" },
    searchEtfs: async () => groupOf(listing("VWRL", "LN"), listing("VWRL", "NA")),
    resolvePrice: async (candidate) => {
      const venue = candidate.instrumentIdentity.exchangeCode;
      resolved.push(venue);

      return venue === "LN"
        ? { ...candidate, priceStatus: "unavailable" }
        : { ...candidate, provider: "yahoo", providerId: "VWRL.AS", priceStatus: "available", marketCurrency: "EUR" };
    },
  });

  assert.deepEqual(resolved, ["LN", "NA"]);
  assert.equal(repaired.providerId, "VWRL.AS");
  assert.equal(repaired.marketCurrency, "EUR");
});

test("nothing is repaired, and nothing is asked, when no venue of the ticker can have a price", async () => {
  let resolveCalls = 0;
  const repaired = await repairEtfBenchmark({
    benchmark: deadBenchmark,
    searchEtfs: async () => groupOf(listing("VWRD", "B2"), listing("VWRD", "E1"), listing("OTHER", "LN")),
    resolvePrice: async (candidate) => {
      resolveCalls += 1;
      return resolvedLondon(candidate);
    },
  });

  assert.equal(repaired, null);
  assert.equal(resolveCalls, 0);
});

test("a venue whose price lookup fails or returns no provider id is skipped, not trusted", async () => {
  const repaired = await repairEtfBenchmark({
    benchmark: deadBenchmark,
    searchEtfs: async () => groupOf(listing("VWRD", "LN"), listing("VWRD", "GR")),
    resolvePrice: async (candidate) => {
      if (candidate.instrumentIdentity.exchangeCode === "GR") return { ...candidate, priceStatus: "available" };
      throw new Error("resolve-price unavailable");
    },
  });

  assert.equal(repaired, null);
});

test("a failed search reaches the caller, which leaves the entry and its note as they are", async () => {
  await assert.rejects(
    repairEtfBenchmark({
      benchmark: deadBenchmark,
      searchEtfs: async () => {
        throw new Error("search unavailable");
      },
      resolvePrice: async (candidate) => candidate,
    }),
    /search unavailable/
  );
});

const readSource = async (relativePath) =>
  (await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("a benchmark with no series is said out loud, both by the server and on its card", async () => {
  const history = await readSource("src/lib/server/portfolio-history.ts");
  const chart = await readSource("src/components/PortfolioLineCharts.tsx");

  // The server warns for a benchmark with no points whatever the instrument warning says.
  const branch = history.slice(history.indexOf("if (historyPoints.length === 0 || dates.length === 0) {"));
  assert.match(branch.slice(0, 600), /warnings\.add\(\s*`Nie udalo sie pobrac historii dla benchmarku/);
  assert.doesNotMatch(branch.slice(0, 600), /if \(!history\?\.warning\)/);
  // A benchmark that is not a holding gets no "purchase data" warning of a holding.
  assert.match(history, /history\.warning && holdingHistoryKeys\.has\(historyKey\)/);

  assert.match(chart, /benchmarkIdsWithoutSeries\.has\(benchmark\.id\)/);
  assert.match(chart, /Brak notowań dla tego benchmarku/);
  // Only judged once the history of this very request has loaded without an error.
  assert.match(chart, /hasHistoryInputs && !isHistoryPending && !error && serverHistorySignature === historyRequestSignature/);
});

test("the repair runs once per entry per page load, only for an ETF without a series, and writes where the picker writes", async () => {
  const chart = await readSource("src/components/PortfolioLineCharts.tsx");

  assert.match(chart, /benchmarkIdsWithoutSeries\.has\(benchmark\.id\) && isRepairableEtfBenchmark\(benchmark\)/);
  assert.match(chart, /if \(benchmarkRepairAttemptedIdsRef\.current\.has\(benchmarkId\)\) continue;\n\s+benchmarkRepairAttemptedIdsRef\.current\.add\(benchmarkId\);/);
  assert.match(chart, /repairEtfBenchmark\(\{\n\s+benchmark,\n\s+searchEtfs: \(query\) => searchEtfInstruments\(\{ query \}\),\n\s+resolvePrice: resolveEtfListingPrice,/);
  // The replacement goes through the same persistence as adding or removing one.
  assert.match(chart, /const applyBenchmarkRepair = [\s\S]*?persistBenchmarkSelection\(nextBenchmarks\);/);
  // Not applied to a chart that is gone.
  assert.match(chart, /if \(repaired && isChartMountedRef\.current\)/);
});
