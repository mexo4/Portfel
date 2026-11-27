import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toSplitAdjustedCloses } from "../src/lib/price-basis.ts";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const rows = (...values) => values.map(([close, adjustedClose], index) => ({ date: `2026-03-0${index + 1}`, close, adjustedClose }));
const closes = (input) => toSplitAdjustedCloses(input).map((row) => Math.round(row.close * 100) / 100);

test("dividends leave the traded prices as they were", () => {
  // A 14 PLN dividend: the adjusted series sits 12% lower before it, the traded one does not.
  assert.deepEqual(closes(rows([82.88, 72.59], [83, 72.7], [70, 70], [71, 71])), [82.88, 83, 70, 71]);
});

test("a split restates the earlier prices, in both directions", () => {
  assert.deepEqual(closes(rows([100, 49], [102, 50], [51, 50.5], [52, 51.5])), [50, 51, 51, 52]);
  // 1:10 reverse split on the third day.
  assert.deepEqual(closes(rows([2, 20], [2.1, 21], [21, 21], [22, 22])), [20, 21, 21, 22]);
  // 3:2.
  assert.deepEqual(closes(rows([150, 100], [100, 100])), [100, 100]);
});

test("rows without an adjusted price are kept as they are", () => {
  assert.deepEqual(closes([{ date: "2026-03-01", close: 10 }, { date: "2026-03-02", close: 5, adjustedClose: 5 }]), [10, 5]);
});

test("holdings ask for traded prices, benchmarks for total return, under keys of their own", async () => {
  const source = await readSource("src/lib/server/portfolio-history.ts");
  assert.match(source, /isTotalReturn \? adjustedCloses\[index\] \?\? closes\[index\] : closes\[index\]/);
  assert.match(source, /`portfolio-history:\$\{isTotalReturn \? "v2" : "v3"\}:yahoo:/);
  assert.match(source, /priceBasis = "traded",\r?\n\}: InstrumentHistoryDefinition,/);
  assert.match(source, /purchaseDate: startDate,\r?\n\s+priceBasis: "total-return",/);
  assert.match(source, /\? `benchmark:\$\{benchmark\.kind\}:/);
  // Dividend-adjusted entries cached before must not seed the traded series.
  const traded = source.slice(source.indexOf("const fetchYahooStockHistory"), source.indexOf("const STOOQ_HISTORY_TIMEOUT_MS"));
  assert.match(traded, /isTotalReturn\r?\n\s+\? `portfolio-history:yahoo:[\s\S]*?: undefined/);
});

test("the engine version changes, so stored results with dividends counted twice are rebuilt", async () => {
  assert.match(await readSource("src/app/api/portfolio-history/route.ts"), /const HISTORY_ENGINE_VERSION = "4";/);
  assert.match(await readSource("src/lib/portfolio-history-client-cache.ts"), /"mexo\.portfolio-history\.v4"/);
});
