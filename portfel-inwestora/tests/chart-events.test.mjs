import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { collectEspiHistory, ESPI_CHART_MAX_PAGES, findEventSlot, getEspiChartTicker, listChartDividends, niceTicks, placeChartEvents, toWarsawDay } = await import("../src/lib/chart-events.ts");
const { buildDividendOperation } = await import("../src/lib/dividend-engine.ts");
const { getPortfolioInstrumentId } = await import("../src/lib/operation-engine.ts");
const { listChartInstruments } = await import("../src/lib/instrument-chart.ts");

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const lot = (symbol, portfolioId) => ({ id: `${portfolioId}-${symbol}`, name: symbol, symbol, kind: "stock", purchaseDate: "2025-01-10", quantity: 10, purchasePrice: 50, purchaseCurrency: "PLN", feePln: 0, marketCurrency: "PLN", provider: "yahoo", latestPrice: 80, createdAt: "" });
const dividend = (portfolioId, symbol, id, { exDividendDate, paymentDate, perShare = 5 }) =>
  buildDividendOperation({
    id, portfolioId, accountId: `${portfolioId}:account:cash:PLN`, instrumentId: getPortfolioInstrumentId(portfolioId, { kind: "stock", symbol }),
    quantity: 10, dividendPerShare: perShare, currency: "PLN", exchangeRate: null, withholdingTax: 0, domesticTax: perShare * 1.9,
    exDividendDate, recordDate: exDividendDate, paymentDate, country: "PL", notes: "", createdAt: "2026-01-01T00:00:00.000Z",
  });
const portfolio = (id, name, symbols, operations) => ({ id, name, createdAt: "", updatedAt: "", assets: symbols.map((symbol) => lot(symbol, id)), sales: [], realizedAdjustments: [], operations, accounts: [] });

test("the dividends of the charted holding come from every portfolio, marked on the day the price drops", () => {
  const first = portfolio("a", "Główny", ["XTB.PL", "PKN.PL"], [
    dividend("a", "XTB.PL", "d1", { exDividendDate: "2025-06-10", paymentDate: "2025-06-24" }),
    dividend("a", "PKN.PL", "other", { exDividendDate: "2025-08-13", paymentDate: "2025-08-27" }),
  ]);
  // An ex-date later than the payment is a form left at the day of entry.
  const second = portfolio("b", "IKE", ["XTB.PL"], [dividend("b", "XTB.PL", "d2", { exDividendDate: "2026-03-01", paymentDate: "2025-07-01", perShare: 2 })]);
  const instrument = listChartInstruments([first, second]).find((item) => item.symbol === "XTB.PL");

  const dividends = listChartDividends([first, second], instrument, { PLN: 1 });

  assert.deepEqual(
    dividends.map((item) => [item.date, item.paymentDate, item.dividendPerShare, item.netAmount, item.portfolioName]),
    [["2025-06-10", "2025-06-24", 5, 40.5, "Główny"], ["2025-07-01", "2025-07-01", 2, 16.2, "IKE"]]
  );
});

test("ESPI is asked only about companies listed in Warsaw", () => {
  const stock = { kind: "stock", symbol: "XTB.PL", marketCurrency: "PLN" };
  assert.equal(getEspiChartTicker(stock), "XTB");
  assert.equal(getEspiChartTicker({ ...stock, symbol: "pkn.wa" }), "PKN");
  assert.equal(getEspiChartTicker({ ...stock, kind: "etf", symbol: "ETFBW20TR.PL" }), null);
  assert.equal(getEspiChartTicker({ ...stock, symbol: "AAPL.US", marketCurrency: "USD" }), null);
});

test("a report belongs to its day in Warsaw", () => {
  assert.equal(toWarsawDay("2026-03-10T23:30:00.000Z"), "2026-03-11");
  assert.equal(toWarsawDay("2026-07-10T21:59:00.000Z"), "2026-07-10");
});

const report = (id, publishedAt) => ({ id, issuerName: "XTB", market: "GPW", reportType: "CURRENT", publishedAt, title: `Raport ${id}`, excerpt: "", category: "DIVIDEND", source: "PAP_ESPI", sourceLabel: "GPW / ESPI", sourceUrl: "https://example.test/r", attachmentsCount: 0, isCorrection: false });
const page = (items, nextCursor) => ({ items, hasMore: Boolean(nextCursor), ...(nextCursor ? { nextCursor } : {}), sync: { status: "SUCCESS", isStale: false } });

test("reports are read page by page and returned oldest first", async () => {
  const requests = [];
  const history = await collectEspiHistory(async (request) => {
    requests.push(request);
    return request.cursor ? page([report("old", "2025-01-02T10:00:00.000Z")]) : page([report("new", "2025-02-02T10:00:00.000Z")], "next");
  });

  assert.deepEqual(requests, [{ market: "GPW" }, { market: "GPW", cursor: "next" }]);
  assert.deepEqual(history.items.map((item) => [item.id, item.date, item.categoryLabel]), [["old", "2025-01-02", "Dywidenda"], ["new", "2025-02-02", "Dywidenda"]]);
  assert.equal(history.isCut, false);
});

test("a long archive stops after a few pages and says so", async () => {
  let calls = 0;
  const history = await collectEspiHistory(async () => {
    calls += 1;
    return page([report(`r${calls}`, `2025-01-${String(28 - calls).padStart(2, "0")}T10:00:00.000Z`)], `c${calls}`);
  });

  assert.equal(calls, ESPI_CHART_MAX_PAGES);
  assert.equal(history.items.length, ESPI_CHART_MAX_PAGES);
  assert.equal(history.isCut, true);
});

test("a company without reports on the main market is looked up on NewConnect", async () => {
  const markets = [];
  const history = await collectEspiHistory(async ({ market }) => {
    markets.push(market);
    return page(market === "NEWCONNECT" ? [report("nc", "2025-01-02T10:00:00.000Z")] : []);
  });

  assert.deepEqual(markets, ["GPW", "NEWCONNECT"]);
  assert.deepEqual(history.items.map((item) => item.id), ["nc"]);
});

const event = (date, id = date) => ({ date, id });
const describe = ({ slots }) => slots.map((slot) => [slot.session, slot.events.map((item) => item.id)]);
// Thursday 2 to Wednesday 8 January 2025, without the weekend.
const sessions = ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07", "2025-01-08"];

test("an event without a session joins the session before it, a fresh one the last session", () => {
  const placed = placeChartEvents(sessions, [event("2025-01-04"), event("2025-01-03"), event("2025-01-10"), event("2025-01-01"), event("2025-02-01")], 100);

  assert.equal(placed.interval, "D");
  assert.deepEqual(describe(placed), [["2025-01-03", ["2025-01-03", "2025-01-04"]], ["2025-01-08", ["2025-01-10"]]]);
});

test("events are grouped by week or month when single days would be too close", () => {
  const weekly = placeChartEvents(sessions, [event("2025-01-02"), event("2025-01-03"), event("2025-01-07")], 3);
  assert.equal(weekly.interval, "W");
  assert.deepEqual(describe(weekly), [["2025-01-02", ["2025-01-02", "2025-01-03"]], ["2025-01-07", ["2025-01-07"]]]);

  // Never finer than the candles drawn.
  const monthly = placeChartEvents(sessions, [event("2025-01-02"), event("2025-01-07")], 100, "M");
  assert.equal(monthly.interval, "M");
  assert.deepEqual(describe(monthly), [["2025-01-02", ["2025-01-02", "2025-01-07"]]]);

  // Any day of the slot, and any bar holding its mark, finds it.
  assert.equal(findEventSlot(weekly.slots, "2025-01-03").session, "2025-01-02");
  assert.equal(findEventSlot(weekly.slots, "2025-01-08").session, "2025-01-07");
  assert.equal(findEventSlot(monthly.slots, "2024-12-30", "2025-01-03").session, "2025-01-02");
  assert.equal(findEventSlot(weekly.slots, "2025-02-03"), null);
});

test("no sessions or no events mean no marks", () => {
  assert.deepEqual(placeChartEvents([], [event("2025-01-02")], 10).slots, []);
  assert.deepEqual(placeChartEvents(sessions, [], 10).slots, []);
});

test("the scale with room for marks still has round values", () => {
  assert.deepEqual(niceTicks(61.3, 97.4), [70, 80, 90]);
  assert.deepEqual(niceTicks(0.92, 1.31), [1, 1.1, 1.2, 1.3]);
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test("ESPI keeps its access gate, and an empty mark list is never handed to Recharts", async () => {
  const workspace = await readSource("src/components/InstrumentChartsWorkspace.tsx");
  assert.match(workspace, /canAccessFeature\(account, "espi"\) \? getEspiChartTicker\(instrument\) : null/);
  assert.match(await readSource("src/components/useChartAnnouncements.ts"), /error\.status === 401 \|\| error\.status === 403/);
  for (const source of [workspace, await readSource("src/components/InstrumentCandleChart.tsx")]) {
    for (const kind of ["espi", "dividend"]) assert.match(source, new RegExp(`eventMarks\\.${kind}\\.length > 0 \\? <Scatter yAxisId="events" data=\\{eventMarks\\.${kind}\\}`));
  }
});
