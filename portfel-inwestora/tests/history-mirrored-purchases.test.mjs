import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBuyCashflowEvents } from "../src/lib/server/portfolio-history.ts";
import { getPortfolioInstrumentId } from "../src/lib/operation-engine.ts";

// A broker import (XTB) writes every purchase as a cash-ledger BUY with cashImpact,
// but links a lotId only for the lots that are still open. The purchases of positions
// that were sold later had no lotId, so their cost was counted as new capital at the
// purchase date (a flow) while their sale, being mirrored, took nothing out. On a
// real import "net invested" exceeded the deposits by 5,493 PLN, the P/L turned
// negative (-3,782 instead of +1,711 PLN) and the daily returns on purchase days
// were -67% and -82%, which made the TWR -97.8% (+48.7% with the true flows).

const portfolioId = "portfolio-1";
const xtb = { kind: "stock", symbol: "XTB.PL" };
const xtbInstrumentId = getPortfolioInstrumentId(portfolioId, xtb);

const ledgerBuy = (overrides = {}) => ({
  id: "999-STOCKPURCHASE-XTB-aaa",
  portfolioId,
  accountId: `${portfolioId}:account:cash:PLN`,
  assetId: xtbInstrumentId,
  operationType: "BUY",
  quantity: 1,
  price: 68.8,
  currency: "PLN",
  fee: 0,
  tax: 0,
  amount: 68.8,
  date: "2025-11-18",
  notes: "",
  metadata: { kind: "cash", cashImpact: true, importSource: "XTB" },
  ...overrides,
});

const allocation = (overrides = {}) => ({
  lotId: "asset-1786533623641-dua6kp",
  quantity: 1,
  purchaseDate: "2025-11-18",
  purchasePrice: 68.8,
  purchaseCurrency: "PLN",
  allocatedBuyFeePln: 0,
  investedPln: 68.8,
  symbol: "XTB.PL",
  kind: "stock",
  ...overrides,
});

const sale = (allocations, overrides = {}) => ({
  id: "sale-1",
  saleDate: "2025-12-01",
  symbol: "XTB.PL",
  kind: "stock",
  realizedInvestedPln: 68.8,
  allocations,
  ...overrides,
});

const mirroredSale = { id: "op-sell", portfolioId, operationType: "SELL", metadata: { cashImpact: true, saleId: "sale-1" } };
const totalFlow = (events) => [...events.values()].reduce((sum, value) => sum + value, 0);

test("a sold lot whose imported purchase has no lotId is not counted as new capital", () => {
  const { events } = buildBuyCashflowEvents([], [sale([allocation()])], new Map(), [ledgerBuy(), mirroredSale]);

  assert.deepEqual([...events.entries()], []);
});

test("without the imported purchase the same lot still counts as a legacy purchase", () => {
  const { events } = buildBuyCashflowEvents([], [sale([allocation()])], new Map(), [mirroredSale]);

  assert.equal(events.get("2025-11-18"), 68.8);
});

test("the match needs the same instrument and the same day", () => {
  const otherDay = buildBuyCashflowEvents([], [sale([allocation({ purchaseDate: "2025-11-19" })])], new Map(), [ledgerBuy(), mirroredSale]);
  const otherInstrument = buildBuyCashflowEvents(
    [],
    [sale([allocation()])],
    new Map(),
    [ledgerBuy({ assetId: getPortfolioInstrumentId(portfolioId, { kind: "stock", symbol: "PKN.PL" }) }), mirroredSale]
  );

  assert.equal(otherDay.events.get("2025-11-19"), 68.8);
  assert.equal(otherInstrument.events.get("2025-11-18"), 68.8);
});

test("one imported purchase covers only the quantity it bought", () => {
  // Two lots of one share each were bought on the day, but the ledger shows a single share.
  const { events } = buildBuyCashflowEvents(
    [],
    [
      sale([allocation({ lotId: "asset-a" })], { id: "sale-a" }),
      sale([allocation({ lotId: "asset-b" })], { id: "sale-b" }),
    ],
    new Map(),
    [ledgerBuy(), { ...mirroredSale, metadata: { cashImpact: true, saleId: "sale-a" } }, { ...mirroredSale, id: "op-sell-b", metadata: { cashImpact: true, saleId: "sale-b" } }]
  );

  assert.equal(totalFlow(events), 68.8, "one lot is covered by the ledger, the other is still a legacy purchase");
});

test("a sale of several lots from one broker purchase is covered as long as the quantities add up", () => {
  const { events } = buildBuyCashflowEvents(
    [],
    [sale([allocation({ lotId: "asset-a", quantity: 4 }), allocation({ lotId: "asset-b", quantity: 6 })])],
    new Map(),
    [ledgerBuy({ quantity: 10, amount: 688 }), mirroredSale]
  );

  assert.deepEqual([...events.entries()], []);
});

test("an open lot without a lotId link is matched the same way", () => {
  const lot = {
    id: "asset-open",
    symbol: "XTB.PL",
    kind: "stock",
    purchaseDate: "2025-11-18",
    quantity: 1,
    purchasePrice: 68.8,
    purchaseCurrency: "PLN",
    feePln: 0,
  };

  assert.deepEqual([...buildBuyCashflowEvents([lot], [], new Map(), [ledgerBuy()]).events.entries()], []);
  assert.equal(buildBuyCashflowEvents([lot], [], new Map(), []).events.get("2025-11-18"), 68.8);
});

test("a purchase that is linked by lotId keeps working exactly as before", () => {
  const lot = {
    id: "asset-linked",
    symbol: "XTB.PL",
    kind: "stock",
    purchaseDate: "2025-11-18",
    quantity: 1,
    purchasePrice: 68.8,
    purchaseCurrency: "PLN",
    feePln: 0,
  };
  const linked = ledgerBuy({ metadata: { cashImpact: true, lotId: "asset-linked" } });
  // An unrelated lot of the same instrument and day must not be absorbed by the linked purchase.
  const other = { ...lot, id: "asset-other" };
  const { events } = buildBuyCashflowEvents([lot, other], [], new Map(), [linked]);

  assert.equal(events.get("2025-11-18"), 68.8, "only the unlinked second lot is a legacy purchase");
});

test("operations without a portfolio id (legacy fixtures) change nothing", () => {
  const { events } = buildBuyCashflowEvents([], [sale([allocation()])], new Map(), [
    { ...ledgerBuy(), portfolioId: undefined },
    { ...mirroredSale, portfolioId: undefined },
  ]);

  assert.equal(events.get("2025-11-18"), 68.8);
});

test("a purchase without cashImpact is not a ledger purchase", () => {
  const { events } = buildBuyCashflowEvents([], [sale([allocation()])], new Map(), [
    ledgerBuy({ metadata: { kind: "legacy" } }),
    mirroredSale,
  ]);

  assert.equal(events.get("2025-11-18"), 68.8);
});

test("the stored history and the browser copy of the old, wrong results are not reused", () => {
  const route = readFileSync(new URL("../src/app/api/portfolio-history/route.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/lib/portfolio-history-client-cache.ts", import.meta.url), "utf8");

  assert.match(route, /HISTORY_ENGINE_VERSION/);
  assert.match(route, /const storeKey = `\$\{HISTORY_ENGINE_VERSION\}:\$\{revision\}:/);
  assert.match(client, /"mexo\.portfolio-history\.v2"/);
});
