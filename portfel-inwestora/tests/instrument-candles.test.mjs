import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const { aggregateCandles, findCandleBar, pickCandleInterval } = await import("../src/lib/instrument-chart.ts");
const { fetchInstrumentCandles, getYahooCandleSymbols } = await import("../src/lib/server/instrument-candles.ts");

const candle = (date, open, high, low, close) => ({ date, open, high, low, close });
// 2026-03-02 is a Monday.
const days = [
  candle("2026-03-02", 10, 12, 9, 11),
  candle("2026-03-03", 11, 15, 10, 14),
  candle("2026-03-06", 14, 14, 8, 9),
  candle("2026-03-09", 9, 10, 9, 10),
  candle("2026-04-01", 10, 20, 10, 19),
];

test("weeks and months open with their first session and keep the extremes", () => {
  assert.deepEqual(aggregateCandles(days, "D").map((bar) => bar.date), days.map((day) => day.date));
  const weeks = aggregateCandles(days, "W");
  assert.deepEqual(weeks.map(({ from, to, open, high, low, close }) => [from, to, open, high, low, close]), [
    ["2026-03-02", "2026-03-06", 10, 15, 8, 9],
    ["2026-03-09", "2026-03-09", 9, 10, 9, 10],
    ["2026-04-01", "2026-04-01", 10, 20, 10, 19],
  ]);
  assert.deepEqual(aggregateCandles(days, "M").map(({ from, open, high, low, close }) => [from, open, high, low, close]), [
    ["2026-03-02", 10, 15, 8, 10],
    ["2026-04-01", 10, 20, 10, 19],
  ]);
  assert.equal(days[0].high, 12, "the input is left as it was");
});

test("the interval keeps the number of candles readable", () => {
  assert.equal(pickCandleInterval(126, 130), "D");
  assert.equal(pickCandleInterval(252, 130), "W");
  assert.equal(pickCandleInterval(1250, 130), "M");
});

test("a trade joins the bar of its week, also on a day without a session", () => {
  const weeks = aggregateCandles(days, "W");
  assert.equal(findCandleBar(weeks, "2026-03-04").from, "2026-03-02");
  assert.equal(findCandleBar(weeks, "2026-03-08").from, "2026-03-02");
  assert.equal(findCandleBar(weeks, "2026-03-01"), null);
});

const passThrough = async (_key, startDate, endDate, fetcher) => fetcher(startDate, endDate);
const history = (currency, extra = {}) => async ({ symbol }) => ({ points: [], candles: [candle("2026-03-02", 200, 220, 190, 210)], currency, name: "Test", instrumentType: "EQUITY", symbol, ...extra });
const gpw = { kind: "stock", symbol: "PKN.PL", marketCurrency: "PLN", provider: "stooq" };

test("candles are taken only in the holding's own currency", async () => {
  const asked = [];
  const track = (inner) => async (request) => { asked.push(request.symbol); return inner(request); };
  const ok = await fetchInstrumentCandles(gpw, "2026-03-01", "2026-03-05", { fetchHistory: track(history("PLN")), cached: passThrough });
  assert.equal(asked[0], "PKN.WA");
  assert.deepEqual(ok, [candle("2026-03-02", 200, 220, 190, 210)]);
  const wrong = await fetchInstrumentCandles(gpw, "2026-03-01", "2026-03-05", { fetchHistory: history("USD"), cached: passThrough });
  assert.deepEqual(wrong, []);
});

test("pence are turned into pounds", async () => {
  const candles = await fetchInstrumentCandles(
    { kind: "stock", symbol: "VOD.L", marketCurrency: "GBP", provider: "yahoo" },
    "2026-03-01", "2026-03-05", { fetchHistory: history("GBp"), cached: passThrough }
  );
  assert.deepEqual(candles, [candle("2026-03-02", 2, 2.2, 1.9, 2.1)]);
});

test("an ETF listing known from EODHD is asked first under its Yahoo spelling", () => {
  const { symbols } = getYahooCandleSymbols({ kind: "etf", symbol: "VWCE", marketCurrency: "EUR", provider: "eodhd", providerId: "VWCE.XETRA" });
  assert.equal(symbols[0], "VWCE.DE");
});

test("a coin's candles need Yahoo to confirm it is that coin", async () => {
  const coin = { kind: "crypto", symbol: "LINK", marketCurrency: "USD", provider: "coingecko", providerId: "chainlink" };
  const asCoin = (name) => history("USD", { instrumentType: "CRYPTOCURRENCY", name });
  assert.equal((await fetchInstrumentCandles(coin, "2026-03-01", "2026-03-05", { fetchHistory: asCoin("Chainlink USD"), cached: passThrough })).length, 1);
  assert.deepEqual(await fetchInstrumentCandles(coin, "2026-03-01", "2026-03-05", { fetchHistory: asCoin("Other Coin USD"), cached: passThrough }), []);
  assert.deepEqual(await fetchInstrumentCandles({ ...coin, marketCurrency: "PLN" }, "2026-03-01", "2026-03-05", { fetchHistory: asCoin("Chainlink USD"), cached: passThrough }), []);
});

test("Yahoo's daily history carries open, high and low, flat where they are missing", async () => {
  const { fetchYahooDailyHistory } = await import("../src/lib/server/yahoo.ts");
  const day = (date) => Date.parse(`${date}T14:00:00.000Z`) / 1000;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ chart: { result: [{ meta: { currency: "PLN" }, timestamp: [day("2026-03-02"), day("2026-03-03"), day("2026-03-04")], indicators: { quote: [{ open: [10, null, 11], high: [12, null, 10.5], low: [9, null, 10], close: [11, 13, null] }], adjclose: [{ adjclose: [1, 1, 1] }] } }] } }));
  try {
    const result = await fetchYahooDailyHistory({ symbol: "PKN.WA", startDate: "2026-03-01", endDate: "2026-03-05" });
    assert.deepEqual(result.candles, [candle("2026-03-02", 10, 12, 9, 11), candle("2026-03-03", 13, 13, 13, 13)]);
    assert.deepEqual(result.points, [{ date: "2026-03-02", close: 11 }, { date: "2026-03-03", close: 13 }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the chart offers both styles, and buy, sell and delete keep their colours", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [charts, positions, css] = await Promise.all([read("src/components/InstrumentChartsWorkspace.tsx"), read("src/components/PositionsWorkspace.tsx"), read("src/app/nowy-wyglad.css")]);
  assert.match(charts, /Liniowy<\/button>/);
  assert.match(charts, /Świecowy<\/button>/);
  assert.match(positions, /<ChartStyleSwitch \/>/);
  for (const rule of [".transaction-button.transaction-button-buy", ".transaction-button.transaction-button-sell", ".ghost-button.action-buy", ".ghost-button.action-sell", ".ghost-button.admin-danger-button"]) {
    assert.ok(css.includes(rule), rule);
  }
  for (const file of ["source-sans-3-latin-wght-normal.woff2", "source-sans-3-latin-ext-wght-normal.woff2"]) {
    assert.ok(css.includes(`url("/fonts/${file}")`), file);
    assert.ok((await stat(new URL(`../public/fonts/${file}`, import.meta.url))).size > 20_000, file);
  }
  assert.match(await read("public/fonts/source-sans-3-LICENSE.txt"), /SIL Open Font License/);
});
