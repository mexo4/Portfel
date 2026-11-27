// Open CFDs from XTB's "Open Positions" sheet. All data here is made up; only the layout of the
// sheet follows the broker's export.
import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

const { parseBrokerOperationsXlsx } = await import("../src/lib/import-operations.ts");
const { getCfdPositionKey, getOpenCfdLotPrice, getOpenCfdMetadata, reconcileXtbOpenCfds } = await import("../src/lib/xtb-open-cfd.ts");
const { getAssetProfitLossPln } = await import("../src/lib/portfolio-engine.ts");
const { normalizePortfolioBook } = await import("../src/lib/portfolio-state.ts");

const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const column = (index) => String.fromCharCode(65 + index);
const workbook = (sheets) => {
  const entries = {};
  sheets.forEach((sheet, index) => {
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${column(c)}${r + 1}`;
      return typeof value === "number" ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    entries[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  entries["xl/workbook.xml"] = strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`);
  entries["xl/_rels/workbook.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`);
  return zipSync(entries, { level: 6 });
};

const cash = (rows) => ({
  name: "Cash Operations",
  rows: [["Account number", "111111"], ["Currency", "USD"],
    ["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment", "Product", "Position ID"], ...rows],
});
const deposit = ["Deposit", "", "", "", 46080.4, 1000, "900001", "Bank transfer", "My Trades", ""];
const closeTrade = (position, amount, id = "900002") =>
  ["Close trade", "Germany 40", "DE40", "CFD", 46099.6, amount, id, `Profit of position #${position}`, "My Trades", position];

const openHeader = ["Product", "Instrument/Position", "Ticker", "Category", "Type", "Volume", "Value", "Current price", "Open price", "Open time (UTC)", "Margin"];
/** quote × volume × contract size = value, rounded to cents as the broker does. */
const position = (id, ticker, volume, openPrice, currentPrice, size, side = "BUY") =>
  ["My Trades", id, ticker, "", side, volume, Math.round(currentPrice * volume * size * 100) / 100, currentPrice, openPrice, 46090.25, 50];
const instrument = (name, ticker, category) => ["My Trades", name, ticker, category, "", 1, 1, "", 1, "", ""];
const openSheet = (rows, { time = 46100.5 } = {}) => ({
  name: "Open Positions",
  rows: [["Account number", "111111"], ["Open Positions", ""], ...(time ? [["Data as of report generated", time]] : []),
    ["Product", "Metric", "Amount", "Currency"], ["My Trades", "Open position value", 1000, "USD"], openHeader, ...rows],
});
const dax = (volume = 0.02, current = 20200) => [instrument("Germany 40", "DE40", "CFD"), position("555000111", "DE40", volume, 20000, current, 25)];
const parse = async (sheets) => parseBrokerOperationsXlsx(workbook(sheets), "xtb");
const openCfds = (result) => result.operations.filter((operation) => operation.rawType?.startsWith("CFD OPEN"));

test("an open CFD is read from the open positions sheet with its contract size", async () => {
  const result = await parse([cash([deposit]), openSheet([
    ...dax(),
    instrument("World ETF", "WRLD.UK", "ETF"),
    position("555000222", "WRLD.UK", 3, 100, 101, 1),
  ])]);
  const [open, ...others] = openCfds(result);
  assert.equal(others.length, 0, "the ETF is already in the cash history, so only the CFD is added");
  assert.deepEqual(
    [open.symbol, open.instrumentType, open.positionDirection, open.positionEffect, open.operationType, open.quantity, open.price, open.contractMultiplier, open.currency, open.cashAmount],
    ["DE40", "CFD", "LONG", "OPEN", "BUY", 0.02, 20000, 25, "USD", 0]
  );
  assert.equal(open.importKey, "xtb-open-cfd:111111:555000111");
  assert.equal(open.snapshotPrice, 20200);
  assert.match(open.positionSnapshotAt, /^2026-03-\d{2}T12:00:00/);
  assert.ok(result.warnings.some((warning) => warning.includes("otwartych pozycji CFD")));
});

test("the contract size is a whole number when only the rounding to cents moves it", async () => {
  const size = async (volume, current, contract) =>
    openCfds(await parse([cash([deposit]), openSheet([instrument("Index", "IDX", "CFD"), position("555000333", "IDX", volume, 100, current, contract)])]))[0].contractMultiplier;
  assert.equal(await size(0.003, 9876.5, 20), 20);
  // An instrument quoted in another currency than the account carries the exchange rate in its size.
  assert.ok(Math.abs((await size(1, 1000, 1.1735)) - 1.1735) < 0.000001);
});

test("a short CFD keeps its direction", async () => {
  const [open] = openCfds(await parse([cash([deposit]), openSheet([instrument("Oil", "OIL", "CFD"), position("555000444", "OIL", 1, 80, 78, 10, "SELL")])]));
  assert.deepEqual([open.positionDirection, open.operationType], ["SHORT", "SELL"]);
});

test("without the time of the report no open CFD is added, and closing rows change nothing", async () => {
  const result = await parse([cash([deposit, closeTrade("555000111", 12)]), openSheet(dax(), { time: null })]);
  assert.equal(openCfds(result).length, 0);
  assert.ok(result.operations.every((operation) => !operation.positionSnapshotAt));
  assert.ok(result.warnings.some((warning) => warning.includes("nie zostały zaimportowane")));
});

test("the closing row of a CFD knows its position and stays a single cash result", async () => {
  const result = await parse([cash([deposit, closeTrade("555000111", 12)]), openSheet([])]);
  const [row] = result.operations.filter((operation) => operation.operationType === "CUSTOM");
  assert.deepEqual([row.brokerPositionId, row.realizedProfitLoss, Boolean(row.positionSnapshotAt)], ["555000111", 12, true]);
  assert.equal(result.operations.filter((operation) => operation.positionEffect).length, 0);
});

/** A lot as it comes back from a save, which keeps only the fields it knows. */
const saved = (assets) => normalizePortfolioBook({ schemaVersion: 2, activePortfolioId: "p", portfolios: [{ id: "p", name: "Główny", assets, sales: [], realizedAdjustments: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] }).portfolios[0].assets;

/** The lot and its operation as the import saves them. */
const imported = (operation) => {
  const lot = { id: "lot-1", symbol: operation.symbol, name: operation.name, kind: "stock", instrumentType: "CFD", positionDirection: "LONG", contractMultiplier: operation.contractMultiplier, purchaseDate: operation.date, quantity: operation.quantity, purchasePrice: operation.price, purchaseCurrency: "USD", purchaseFxRateToPln: 4, feePln: 0, marketCurrency: "USD", provider: "catalog", createdAt: "", ...getOpenCfdLotPrice(operation) };
  return { lot: saved([lot])[0], operations: [{ id: "op-1", metadata: { lotId: lot.id, ...getOpenCfdMetadata(operation) } }] };
};

test("an index CFD keeps XTB's quote, and its result matches the broker's", async () => {
  const [open] = openCfds(await parse([cash([deposit]), openSheet(dax())]));
  const { lot, operations } = imported(open);
  assert.deepEqual([lot.latestPrice, lot.priceSource], [20200, undefined]);
  assert.equal(operations[0].metadata.cfdPositionKey, getCfdPositionKey(open));
  // (20200 − 20000) × 0.02 × 25 = 100 USD, at 4 PLN.
  assert.equal(getAssetProfitLossPln(lot, { PLN: 1, USD: 4 }), 400);
  assert.equal(saved([{ ...lot, leverage: 20 }])[0].leverage, 20, "the leverage survives a save");
  const [own] = reconcileXtbOpenCfds({ assets: [{ ...lot, priceSource: "MANUAL", latestPrice: 19000 }], operations, imported: [{ ...open, positionSnapshotAt: "2026-04-01T00:00:00.000Z" }] }).assets;
  assert.equal(own.latestPrice, 19000, "a price the user set stays");
  const [live] = reconcileXtbOpenCfds({ assets: [{ ...lot, symbol: "US100" }], operations, imported: [{ ...open, positionSnapshotAt: "2026-04-01T00:00:00.000Z" }] }).assets;
  assert.equal(live.latestPrice, 20200, "a refreshed CFD keeps its own price");
  assert.deepEqual(getOpenCfdLotPrice({ ...open, importKey: "xtb:v2:111111:1" }), {});
});

test("newer files close, reduce and reprice the position; older ones never bring it back", async () => {
  const first = await parse([cash([deposit]), openSheet(dax())]);
  const { lot, operations } = imported(openCfds(first)[0]);
  const apply = async (assets, sheets) => reconcileXtbOpenCfds({ assets, operations, imported: (await parse(sheets)).operations });

  const same = await apply([lot], [cash([deposit]), openSheet(dax())]);
  assert.equal(same.assets.length, 1);
  assert.deepEqual([same.closed, same.reduced, same.repriced], [0, 0, 0]);

  const later = await apply([lot], [cash([deposit]), openSheet(dax(0.02, 20300), { time: 46101.5 })]);
  assert.deepEqual([later.assets[0].latestPrice, later.repriced], [20300, 1]);

  const partly = await apply(later.assets, [cash([deposit, closeTrade("555000111", 40)]), openSheet(dax(0.01, 20300), { time: 46102.5 })]);
  assert.deepEqual([partly.assets[0].quantity, partly.reduced], [0.01, 1]);

  const olderAgain = await apply(partly.assets, [cash([deposit]), openSheet(dax())]);
  assert.deepEqual([olderAgain.assets[0].quantity, olderAgain.assets[0].latestPrice], [0.01, 20300]);

  const gone = await apply(partly.assets, [cash([deposit, closeTrade("555000111", 40), closeTrade("555000111", 55, "900003")]), openSheet([], { time: 46103.5 })]);
  assert.deepEqual([gone.assets.length, gone.closed], [0, 1]);
});

test("a position is closed only on a closing row with its own number in a file that lists open positions", async () => {
  const { lot, operations } = imported(openCfds(await parse([cash([deposit]), openSheet(dax())]))[0]);
  const apply = async (sheets) => reconcileXtbOpenCfds({ assets: [lot], operations, imported: (await parse(sheets)).operations });

  assert.equal((await apply([cash([deposit]), openSheet([], { time: 46103.5 })])).assets.length, 1, "missing is not enough");
  assert.equal((await apply([cash([deposit, closeTrade("999999999", 5)]), openSheet([])])).assets.length, 1, "another position");
  assert.equal((await apply([cash([deposit, closeTrade("555000111", 5)])])).assets.length, 1, "no open positions sheet");
  const otherAssets = [{ ...lot, id: "manual-lot" }];
  assert.equal(reconcileXtbOpenCfds({ assets: otherAssets, operations, imported: (await parse([cash([deposit, closeTrade("555000111", 5)]), openSheet([])])).operations }).assets, otherAssets);
});
