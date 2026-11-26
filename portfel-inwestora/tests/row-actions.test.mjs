import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { getAssetEntryHref, getAssetEntryMode, getDividendEntryHref, getHeldInstrumentDraftFields, getLatestLot } = await import("../src/lib/asset-entry-prefill.ts");
const { getPortfolioAssetGroupKey, normalizeGpwSymbol, normalizeSymbol } = await import("../src/lib/ticker.ts");
const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const lot = (overrides = {}) => ({
  id: "lot-1", name: "Orlen", symbol: "PKN.PL", kind: "stock", purchaseDate: "2026-01-05", createdAt: "2026-01-05T10:00:00.000Z",
  quantity: 5, purchasePrice: 60, purchaseCurrency: "PLN", feePln: 0, marketCurrency: "PLN", provider: "stooq", providerId: "pkn",
  ...overrides,
});

test("the form opens in the search mode that matches the held instrument", () => {
  assert.equal(getAssetEntryMode(lot()), "stock-gpw");
  assert.equal(getAssetEntryMode(lot({ symbol: "TM.US", marketCurrency: "USD", provider: "yahoo" })), "stock-global");
  assert.equal(getAssetEntryMode(lot({ symbol: "SAP.DE", marketCurrency: "EUR", provider: "yahoo" })), "stock-international");
  for (const kind of ["etf", "crypto", "bond"]) assert.equal(getAssetEntryMode(lot({ kind })), kind);
});

test("a sale prepared from a row finds the same position", () => {
  const held = [
    lot(),
    lot({ symbol: "XTB", provider: "catalog" }),
    lot({ symbol: "TM.US", marketCurrency: "USD", provider: "yahoo" }),
    lot({ kind: "etf", symbol: "VWCE", marketCurrency: "EUR", provider: "eodhd", instrumentIdentity: { ticker: "VWCE", name: "Vanguard", instrumentType: "ETF", figi: "BBG00X", currency: "EUR" } }),
    lot({ symbol: "US500", marketCurrency: "USD", provider: "catalog", instrumentType: "CFD", positionDirection: "SHORT", contractMultiplier: 20 }),
  ];
  for (const asset of held) {
    const draft = getHeldInstrumentDraftFields(asset);
    // The form normalizes the symbol the way its search mode does before looking for the position.
    const symbol = getAssetEntryMode(asset) === "stock-gpw" ? normalizeGpwSymbol(draft.symbol) : normalizeSymbol(draft.symbol);
    assert.equal(
      getPortfolioAssetGroupKey({ ...draft, symbol }),
      getPortfolioAssetGroupKey(asset),
      asset.symbol
    );
  }
});

test("the newest purchase supplies the instrument data", () => {
  const lots = [lot({ id: "old", purchaseDate: "2025-01-02" }), lot({ id: "new", purchaseDate: "2026-03-01" }), lot({ id: "mid", purchaseDate: "2025-08-01" })];
  assert.equal(getLatestLot(lots).id, "new");
});

test("row links carry the holding and, in the combined view, its portfolio", () => {
  assert.equal(getAssetEntryHref("lot-1", "buy"), "/portfolio/positions?add=asset&walor=lot-1&strona=kup");
  assert.equal(getAssetEntryHref("lot-1", "sell", "p-2"), "/portfolio/positions?add=asset&walor=lot-1&strona=sprzedaj&cel=p-2");
  assert.equal(getDividendEntryHref("lot-1", "p-2"), "/portfolio/dividends?walor=lot-1&cel=p-2");
});

test("Pozycje has the row icons and the combined view never sends the user away to pick a portfolio", async () => {
  const [positions, importView, app] = await Promise.all([
    readSource("src/components/PositionsWorkspace.tsx"),
    readSource("src/components/WorkspaceImportView.tsx"),
    readSource("src/components/PortfolioApp.tsx"),
  ]);
  for (const label of ["Kup", "Sprzedaj", "Dodaj dywidendę", "Historia operacji", "Wykres i analiza"]) assert.ok(positions.includes(`label: "${label}"`), label);
  assert.match(positions, /<RowActions/);
  assert.doesNotMatch(positions, /"\/portfolios"/);
  assert.match(importView, /<PortfolioChooser/);
  assert.doesNotMatch(importView, /"\/portfolios"/);
  assert.doesNotMatch(app, /isAllPortfoliosSelected \? "\/portfolios"/);
});

test("the search leaves a prefilled instrument alone and the cursor goes to the search field", async () => {
  const [app, form, routes] = await Promise.all([
    readSource("src/components/PortfolioApp.tsx"),
    readSource("src/components/AddAssetForm.tsx"),
    readSource("src/components/WorkspaceRouteViews.tsx"),
  ]);
  assert.match(app, /trimmedQuery\.length < minimumSearchLength \|\| isPrefilledDraft/);
  assert.match(form, /!isPrefilled &&/);
  assert.match(form, /input\.focus\(\{ preventScroll: true \}\)/);
  // The reset effect stays first: the form is cleared, then filled.
  assert.ok(routes.indexOf("if (isAddAssetOpen) resetAssetEntryForm()") < routes.indexOf("prefillAssetEntry({ lotId: entryLotId"));
});
