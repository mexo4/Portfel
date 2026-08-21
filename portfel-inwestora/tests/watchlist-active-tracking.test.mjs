import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getGpwWatchlistCanonicalKey,
  isWatchlistEligibleGpwResult,
  normalizeWatchlistItemInput,
} from "../src/lib/watchlist.ts";

test("watchlist identity is GPW market-scoped and never a bare global ticker", () => {
  assert.equal(getGpwWatchlistCanonicalKey("DNP.PL"), "gpw:ticker:DNP");
  assert.equal(getGpwWatchlistCanonicalKey("DNP.WA"), "gpw:ticker:DNP");
  assert.notEqual(getGpwWatchlistCanonicalKey("DNP.PL"), getGpwWatchlistCanonicalKey("KPL.PL"));
});

test("only Polish GPW stock search results can be watched", () => {
  const dino = {
    kind: "stock",
    symbol: "DNP.WA",
    name: "Dino Polska",
    marketCurrency: "PLN",
    provider: "stooq",
  };
  assert.equal(isWatchlistEligibleGpwResult(dino), true);
  assert.deepEqual(normalizeWatchlistItemInput(dino), {
    canonicalKey: "gpw:ticker:DNP",
    symbol: "DNP.WA",
    name: "Dino Polska",
    marketCurrency: "PLN",
    provider: "stooq",
    providerId: undefined,
    isin: undefined,
  });
  assert.equal(isWatchlistEligibleGpwResult({ ...dino, symbol: "DNP", marketCurrency: "USD" }), false);
  assert.equal(isWatchlistEligibleGpwResult({ ...dino, kind: "etf" }), false);
});

test("future corporate events use open holdings plus watchlist, never historical operations", async () => {
  const route = await readFile(new URL("../src/app/api/corporate-events/route.ts", import.meta.url), "utf8");
  const helperStart = route.indexOf("const getHeldGpwInstruments");
  const helperEnd = route.indexOf("const uniqueGpwInputs", helperStart);
  const heldHelper = route.slice(helperStart, helperEnd);

  assert.match(route, /getUserWatchlist\(accountData\.user\.id\)/);
  assert.match(route, /getWatchlistCorporateEventInputs\(watchlist\)/);
  assert.match(route, /trackingSource:/);
  assert.match(route, /automaticInstruments = uniqueGpwInputs\(getHeldGpwInstruments\(initialBook\.portfolios\)\)/);
  assert.match(heldHelper, /normalizedPortfolio\.assets\.map/);
  assert.doesNotMatch(heldHelper, /normalizedPortfolio\.operations/);
});

test("watchlist route, navigation and UI make add/remove explicit without touching portfolio operations", async () => {
  const [apiRoute, nav, views, panel, addForm, db] = await Promise.all([
    readFile(new URL("../src/app/api/watchlist/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AppWorkspaceShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/WorkspaceRouteViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/WatchlistWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AddAssetForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8"),
  ]);

  assert.match(apiRoute, /export async function POST/);
  assert.match(apiRoute, /export async function DELETE/);
  assert.match(nav, /label: "Obserwowane"/);
  assert.match(views, /WorkspaceWatchlistPage/);
  assert.match(panel, /Następne wydarzenie/);
  assert.match(panel, /Nadchodząca dywidenda/);
  assert.match(addForm, /onToggleWatchlist/);
  assert.match(addForm, /aria-pressed=\{isWatchlisted\}/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS user_watchlist_items/);
  assert.match(db, /UNIQUE \(user_id, canonical_key\)/);
});

test("watchlist-only dividends are informational and never show a synthetic entitlement", async () => {
  const panel = await readFile(new URL("../src/components/UpcomingDividendsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /event\.trackingSource === "WATCHLIST"/);
  assert.match(panel, /Obserwowane · bez pozycji w portfelu/);
  assert.match(panel, /!isWatchlistOnly && event\.estimatedGrossAmount !== undefined/);
});
