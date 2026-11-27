// CFD quotes, figures and closed trades. All prices and results here are made up.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

const { getCfdFigures, getCfdLeverage, getCfdQuoteSource, getQuantityUnit, readClosedCfdTrade } = await import("../src/lib/cfd.ts");
const { mergeQuoteIntoPortfolioAsset, refreshPortfolioQuotesWithProgress, applyRefreshedPortfolioAssetSnapshot } = await import("../src/lib/api.ts");
const { fetchCfdQuoteServer } = await import("../src/lib/server/cfd-quotes.ts");
const { parseBrokerOperationsXlsx } = await import("../src/lib/import-operations.ts");
const { attachClosedCfdDetails } = await import("../src/lib/xtb-open-cfd.ts");
const { buildClosedInvestments, listImportedCfdCloses } = await import("../src/lib/closed-investments.ts");

const lot = (overrides = {}) => ({ id: "lot-1", name: "US100", symbol: "US100", kind: "stock", instrumentType: "CFD", positionDirection: "LONG", contractMultiplier: 20, leverage: 20, quantity: 0.01, purchaseDate: "2026-03-02", purchasePrice: 20000, latestPrice: 19800, purchaseCurrency: "USD", marketCurrency: "USD", provider: "catalog", feePln: 0, createdAt: "", ...overrides });

test("only a checked CFD has a quote source", () => {
  assert.equal(getCfdQuoteSource(lot()).yahooSymbol, "NQ=F");
  assert.equal(getCfdQuoteSource(lot({ symbol: "GOLD" })), null);
  assert.equal(getCfdQuoteSource(lot({ instrumentType: undefined })), null, "a share with the same letters is not the CFD");
});

test("a CFD is counted in lots, everything else in pieces", () => {
  assert.deepEqual([0.01, 2.5, 1, 2, 4, 5, 12, 13, 21, 22, 112].map((volume) => getQuantityUnit(volume, true)),
    ["lota", "lota", "lot", "loty", "loty", "lotów", "lotów", "lotów", "lotów", "loty", "lotów"]);
  assert.deepEqual([getQuantityUnit(1), getQuantityUnit(0.5, false)], ["szt.", "szt."]);
});

test("leverage, margin and the return on the margin follow the broker", () => {
  // 20000 × 0.01 × 20 = 4000 of contract, 200 of margin.
  assert.equal(getCfdLeverage(4000, 200.01), 20);
  assert.equal(getCfdLeverage(4000, 0), undefined);
  const figures = getCfdFigures([lot()]);
  assert.deepEqual([figures.leverage, figures.margin, figures.exposure], [20, 200, 3960]);
  assert.ok(Math.abs(figures.priceMovePercent + 1) < 1e-9);
  assert.ok(Math.abs(figures.returnOnMarginPercent + 20) < 1e-9, "a 1% move at 1:20 is 20% of the deposit");
  assert.ok(Math.abs(getCfdFigures([lot({ positionDirection: "SHORT" })]).returnOnMarginPercent - 20) < 1e-9);
  assert.deepEqual([getCfdFigures([lot(), lot({ leverage: undefined })]).margin, getCfdFigures([lot(), lot({ leverage: undefined })]).returnOnMarginPercent], [null, null]);
  assert.equal(getCfdFigures([lot({ latestPrice: undefined })]).exposure, null);
});

test("a refreshed CFD takes the price and keeps its identity", () => {
  const quote = { symbol: "OTHER", name: "Something else", price: 20100, marketCurrency: "PLN", provider: "yahoo", providerId: "NQ=F", instrumentType: "EQUITY", fetchedAt: "2026-03-03T10:00:00.000Z", previousClose: 20050 };
  const next = mergeQuoteIntoPortfolioAsset(lot({ priceSource: "AUTOMATIC" }), quote);
  assert.deepEqual([next.latestPrice, next.previousClose, next.symbol, next.name, next.provider, next.providerId, next.instrumentType, next.marketCurrency, next.priceSource], [20100, 20050, "US100", "US100", "catalog", undefined, "CFD", "USD", "AUTOMATIC"]);
  assert.equal(next.leverage, 20);
  const other = lot({ symbol: "GOLD" });
  assert.equal(mergeQuoteIntoPortfolioAsset(other, quote), other);
  const manual = lot({ priceSource: "MANUAL" });
  assert.equal(applyRefreshedPortfolioAssetSnapshot(manual, { ...lot(), latestPrice: 1 }), manual);
});

test("the refresh asks for the CFD with a source, as a CFD, and for no other", async () => {
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ quote: { symbol: "US100", price: 20200, marketCurrency: "USD", provider: "catalog", fetchedAt: "2026-03-03T11:00:00.000Z" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const { assets } = await refreshPortfolioQuotesWithProgress([lot(), lot({ id: "lot-2", symbol: "DE40" })]);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /symbol=US100/);
    assert.match(asked[0], /cfd=1/);
    assert.deepEqual(assets.map((asset) => asset.latestPrice), [20200, 19800]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the server takes only the price from the source, and only in dollars", async () => {
  const position = { symbol: "US100", marketCurrency: "PLN", provider: "catalog" };
  const source = getCfdQuoteSource(lot());
  const quote = { symbol: "NQ=F", price: 20150, marketCurrency: "USD", provider: "yahoo", providerId: "NQ=F", name: "Nasdaq future", fetchedAt: "2026-03-03T12:00:00.000Z", priceDate: "2026-03-03", marketTimestamp: "2026-03-03T11:59:00.000Z" };
  const history = async () => ({ points: [{ date: "2026-02-27", close: 19900 }, { date: "2026-03-02", close: 20010 }, { date: "2026-03-03", close: 20150 }] });
  const result = await fetchCfdQuoteServer(source, position, { quote: async ({ symbol }) => (symbol === "NQ=F" ? quote : null), history });
  assert.deepEqual([result.symbol, result.price, result.previousClose, result.marketCurrency, result.provider, result.providerId, result.instrumentType, result.name], ["US100", 20150, 20010, "PLN", "catalog", undefined, "CFD", undefined]);
  assert.equal(await fetchCfdQuoteServer(source, position, { quote: async () => ({ ...quote, marketCurrency: "EUR" }), history }), null);
  assert.equal((await fetchCfdQuoteServer(source, position, { quote: async () => quote, history: async () => { throw new Error("offline"); } })).previousClose, undefined);
  const route = await readFile(new URL("../src/app/api/quote/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(isCfd\) \{[\s\S]{0,300}: null;/, "a CFD without a source gets no share quote");
});

test("a CFD is charted from its source, never by its ticker", async () => {
  const route = await readFile(new URL("../src/app/api/instrument-history/route.ts", import.meta.url), "utf8");
  const branch = route.slice(route.indexOf("if (isCfd) {"), route.indexOf("const candles = (await fetchInstrumentCandles"));
  assert.match(branch, /fetchYahooDailyHistory\(\{ symbol: source\.yahooSymbol/);
  assert.match(branch, /return \{ key, points/);
  assert.doesNotMatch(branch, /fetchInstrument/);
});

// ---- closed CFDs from the XTB file ----
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const workbook = (sheets) => {
  const entries = {};
  sheets.forEach((sheet, index) => {
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
      return typeof value === "number" ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    entries[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  entries["xl/workbook.xml"] = strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  entries["xl/_rels/workbook.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  return zipSync(entries, { level: 6 });
};
const cash = (rows) => ({ name: "Cash Operations", rows: [["Account number", "111111"], ["Currency", "USD"],
  ["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment", "Product", "Position ID"], ...rows] });
const closeRow = (id, position, amount, time = 46084.5) => ["Close trade", "US100", "US100", "CFD", time, amount, id, `Profit of position #${position}`, "My Trades", position];
const closedHeader = ["Instrument", "Category", "Ticker", "Type", "Volume", "Open Price", "Open Time (UTC)", "Close Price", "Close Time (UTC)", "Profit/Loss", "Gross Profit", "Purchase Value", "Sale Value", "Margin", "Position ID"];
/** As XTB writes a CFD: no purchase or sale value, the position number stored as a number. */
const closed = (position, side, volume, open, close, gross, margin, category = "CFD") =>
  ["US100", category, "US100", side, volume, open, 46083.4, close, 46084.5, gross - 0.5, gross, "", "", margin, position];
const closedSheet = (rows) => ({ name: "Closed Positions", rows: [["Account number", "111111"], closedHeader, ...rows] });
const deposit = ["Deposit", "", "", "", 46080.4, 1000, "900001", "Bank transfer", "My Trades", ""];
const parse = (sheets) => parseBrokerOperationsXlsx(workbook(sheets), "xtb");

test("a closed CFD is joined to its cash row, with the contract size from its result", async () => {
  const result = await parse([cash([deposit, closeRow("900002", "555000111", 40), closeRow("900003", "555000222", -2)]),
    closedSheet([
      // (20200 − 20000) × 0.01 × 20 = 40; the margin of 200 is 1:20.
      closed(555000111, "BUY", 0.01, 20000, 20200, 40, 200),
      closed(555000222, "SELL", 1, 100, 102, -2, 20),
    ])]);
  const rows = result.operations.filter((operation) => operation.operationType === "CUSTOM");
  assert.equal(result.operations.length, 3, "no trade operation is added, so no money is added");
  assert.deepEqual(rows.map((row) => [row.cfdTrade.positionId, row.cfdTrade.contractMultiplier, row.cfdTrade.leverage, row.cfdTrade.side, row.cfdTrade.grossResult]).sort(),
    [["555000111", 20, 20, "BUY", 40], ["555000222", 1, 5, "SELL", -2]]);
  assert.ok(rows.every((row) => readClosedCfdTrade(row.cfdTrade)));
});

test("a row that does not match its cash row stays only a cash result", async () => {
  const result = await parse([cash([deposit, closeRow("900002", "555000111", 40)]),
    closedSheet([
      closed(555000111, "BUY", 0.01, 20000, 20200, 41, 200), // another amount
      closed(555000999, "BUY", 0.01, 20000, 20200, 40, 200), // another position
      closed(555000111, "BUY", 0.01, 20000, 19800, 40, 200), // a profit on a falling long
      closed(555000111, "BUY", 0.01, 20000, 20200, 40, 200, "STOCK"),
    ])]);
  assert.ok(result.operations.every((operation) => !operation.cfdTrade));
});

test("the details join a stored cash row once, and the closed list shows the booked amount", async () => {
  const { operations: imported } = await parse([cash([deposit, closeRow("900002", "555000111", 40)]), closedSheet([closed(555000111, "BUY", 0.01, 20000, 20200, 40, 200)])]);
  const row = imported.find((operation) => operation.cfdTrade);
  // As an earlier version of the import saved it: no details, and the result booked at 4 PLN.
  const stored = [{ id: "op-1", operationType: "CUSTOM", amount: 40, date: row.date, metadata: { importKey: row.importKey } }];
  const adjustments = [{ id: "a-1", source: "broker-import", importKey: `${row.importKey}:result`, amount: 40, currency: "USD", amountPlnSnapshot: 160, date: row.date, note: "", createdAt: "" }];
  const first = attachClosedCfdDetails(stored, imported);
  assert.equal(first.attached, 1);
  assert.equal(first.operations[0].amount, 40);
  const again = attachClosedCfdDetails(first.operations, imported);
  assert.deepEqual([again.attached, again.operations === first.operations], [0, true]);

  const portfolio = { id: "p", name: "Główny", sales: [], assets: [], operations: first.operations, realizedAdjustments: adjustments };
  const report = buildClosedInvestments([portfolio]);
  const [trade] = report.trades;
  // Margin 200 USD at 4 PLN; 40 USD of result is 20% of it.
  assert.deepEqual([report.totals.trades, trade.profitLossPln, trade.investedPln, trade.returnPercent, trade.cfd.leverage, trade.instrumentType], [1, 160, 800, 20, 20, "CFD"]);
  assert.equal(report.totals.profitLossPln, adjustments.reduce((sum, item) => sum + item.amountPlnSnapshot, 0), "counted once");
  assert.equal(listImportedCfdCloses({ ...portfolio, realizedAdjustments: [] }).length, 0, "without a booked result there is nothing to show");
});
