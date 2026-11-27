import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { describeTrade, getUnsavedTradeNotice } = await import("../src/lib/trade-notice.ts");
const read = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the instrument charts draw their marks outside the tooltip", async () => {
  // A series with its own points limits the tooltip to that many positions, so it stops following.
  for (const name of ["InstrumentChartsWorkspace", "InstrumentCandleChart", "instrument-chart-parts"]) {
    const source = await read(`components/${name}.tsx`);
    assert.doesNotMatch(source, /<Scatter[\s>]/, name);
    assert.doesNotMatch(source, /<(Line|Bar|Area) data=/, name);
    assert.doesNotMatch(source, /yAxisId="events"/, `${name}: Recharts draws nothing on an axis without a series`);
  }
  const parts = await read("components/instrument-chart-parts.tsx");
  assert.match(parts, /<ReferenceDot/);
});

test("a saved purchase or sale is announced with what, how much, at what price and where", () => {
  const trade = { quantity: 2.5, name: "Przykład", symbol: "ABC.US", price: 10.5, currency: "USD", portfolioName: "Główny" };
  const bought = describeTrade({ ...trade, action: "buy" });
  assert.deepEqual([bought.side, bought.title], ["buy", "Kupiono"]);
  assert.match(bought.detail, /^2,5 × Przykład \(ABC\.US\) po 10,50\s(USD|US\$) · portfel „Główny”$/);
  assert.deepEqual(
    ["sell", "open-cfd", "open-short", "close-position"].map((action) => { const notice = describeTrade({ ...trade, action }); return `${notice.side} ${notice.title}`; }),
    ["sell Sprzedano", "buy Otwarto pozycję CFD", "sell Otwarto krótką pozycję", "sell Zamknięto pozycję"]
  );
  const swapped = describeTrade({ action: "swap-bond", quantity: 3, name: "EDO0136", symbol: "EDO0136", portfolioName: "Główny" });
  assert.equal(swapped.detail, "3 × EDO0136 · portfel „Główny”");
});

test("a trade is saved at once, the form waits for it, and a rejected save says so", async () => {
  const app = await read("components/PortfolioApp.tsx");
  const commit = app.slice(app.indexOf("const commitOperationPortfolioSnapshot"), app.indexOf("const restoreLastPersistedPortfolioBook"));
  assert.match(commit, /await persistOperationTargetChange\(nextPortfolio, targetPortfolioId, expectedScopeKey\);/);
  assert.doesNotMatch(commit, /handlePortfolioCoreModelChange/, "no trade is left to the delayed autosave");
  assert.match(commit, /if \(tradeCommitInFlightRef\.current\) \{\s+throw new Error/, "a second trade waits for the first");
  assert.match(commit, /error\.status === 409\) \{\s+setTradeNotice\(getUnsavedTradeNotice\(\)\);/);
  assert.match(commit, /updateWorkspaceAssets\(\(\) => previousWorkspace\.assets\);/, "a failed save restores the lists");
  assert.match(app, /if \(!\(error instanceof ApiError && error\.status === 409\)\) \{\s+portfoliosRef\.current = previousPortfolios;/);
  assert.match(app, /window\.addEventListener\("beforeunload", keepUnsavedChanges\);/);
  assert.match(await read("lib/api.ts"), /keepalive: new TextEncoder\(\)\.encode\(body\)\.length < 60_000/);
  assert.equal(getUnsavedTradeNotice().side, "error");
});

test("every way of saving a trade announces it, and „Dodaj transakcję” has its own colour", async () => {
  const app = await read("components/PortfolioApp.tsx");
  assert.equal(app.match(/announceTrade\(\{/g)?.length, 6, "buy, sell and the four bond actions");
  assert.match(app, /<TradeNoticeToast notice=\{tradeNotice\} onClose=\{closeTradeNotice\} \/>/);
  assert.match(await read("components/WorkspaceRouteViews.tsx"), /primary-button button-add-trade/);
  const css = await read("app/nowy-wyglad.css");
  assert.match(css, /\.primary-button\.button-add-trade \{[^}]*var\(--solid-trade\)/);
  assert.match(css, /\.workspace-quick-actions-popover > button:first-of-type \{[^}]*var\(--solid-trade\)/);
});
