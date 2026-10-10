import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("benchmark search routes ETF queries through the isolated ETF client", async () => {
  const source = await readSource("src/components/PortfolioLineCharts.tsx");

  assert.match(source, /import\s*\{[^}]*searchEtfInstruments[^}]*\}\s*from "@\/lib\/api"/s);
  assert.match(source, /benchmarkSearchMode === "etf"[\s\S]*searchEtfInstruments\(/);
  assert.match(source, /controller\.abort\(\)/);
});

test("line chart no longer exposes a candlestick presentation switch", async () => {
  const source = await readSource("src/components/PortfolioLineCharts.tsx");
  const styles = await readSource("src/app/globals.css");

  assert.doesNotMatch(source, /chartPresentation|renderPresentationToggle|line-visual-candle/);
  assert.doesNotMatch(styles, /line-visual-presentation-toggle|line-visual-candle/);
});

test("clean dividend form requires explicit instrument and account selection", async () => {
  const source = await readSource("src/components/DividendCashWorkspace.tsx");

  assert.match(source, /const getDefaultDividendDraft = \(\): DividendDraft/);
  assert.match(source, /instrumentId:\s*""/);
  assert.match(source, /accountId:\s*""/);
  assert.match(source, /<option value="">Wybierz instrument<\/option>/);
  assert.match(source, /<option value="">Wybierz konto<\/option>/);
});

test("average purchase and unit-price cells inherit the same numeric rendering as dividends", async () => {
  const styles = await readSource("src/app/globals.css");
  const selector = styles.match(
    /\.portfolio-positions-table \.portfolio-number,[\s\S]*?\.workspace-position-card \.portfolio-number \{([\s\S]*?)\n\}/
  );

  assert.ok(selector);
  assert.match(selector[1], /font-family:\s*inherit/);
  assert.match(selector[1], /font-variant-numeric:\s*normal/);
  assert.match(selector[1], /font-feature-settings:\s*normal/);
  assert.match(selector[1], /letter-spacing: normal/);
  assert.match(selector[1], /word-spacing: normal/);
  assert.doesNotMatch(selector[1], /"tnum"/);
});

test("current-position primary prices reuse the exact dividend-report hierarchy", async () => {
  const table = await readSource("src/components/AssetTable.tsx");
  const styles = await readSource("src/app/globals.css");

  assert.match(table, /financial-value portfolio-financial-primary/);
  const selector = styles.match(
    /\.portfolio-positions-table \.portfolio-financial-primary \{([\s\S]*?)\n\}/
  );

  assert.ok(selector);
  assert.match(selector[1], /font-family:\s*var\(--font-sans\), sans-serif/);
  assert.match(selector[1], /font-size:\s*0\.9rem/);
  assert.match(selector[1], /font-weight:\s*700/);
  assert.match(selector[1], /font-variant-numeric:\s*normal/);
});

test("the global portfolio scope picker replaces the legacy single-portfolio dropdown", async () => {
  const shell = await readSource("src/components/AppWorkspaceShell.tsx");

  assert.equal((shell.match(/<PortfolioScopePicker /g) ?? []).length, 2);
  assert.doesNotMatch(shell, /Aktywny portfel<\/span><select/);
  assert.match(shell, /portfolioScope: PortfolioScopeSelection/);
  assert.match(shell, /onPortfolioScopeChange: \(selection: PortfolioScopeSelection\)/);
});

test("portfolio and currency overlays escape transformed ancestors and use contained option scrolling", async () => {
  const [portfolioPicker, currencyPicker, importPicker, styles] = await Promise.all([
    readSource("src/components/PortfolioScopePicker.tsx"),
    readSource("src/components/CurrencyPicker.tsx"),
    readSource("src/components/ImportPlatformPicker.tsx"),
    readSource("src/app/globals.css"),
  ]);

  assert.match(portfolioPicker, /import\s*\{\s*createPortal\s*\}\s*from "react-dom"/);
  assert.match(portfolioPicker, /createPortal\([\s\S]*?document\.body\)/);
  assert.match(portfolioPicker, /portfolio-scope-backdrop\$\{mobile \? " is-mobile"/);
  assert.match(currencyPicker, /import\s*\{\s*createPortal\s*\}\s*from "react-dom"/);
  assert.match(currencyPicker, /createPortal\([\s\S]*?document\.body/);
  assert.match(currencyPicker, /currency-picker-grid mexo-option-scroll-area/);
  assert.match(importPicker, /import\s*\{\s*createPortal\s*\}\s*from "react-dom"/);
  assert.match(importPicker, /createPortal\([\s\S]*?document\.body/);
  assert.match(importPicker, /import-platform-sections mexo-option-scroll-area/);
  assert.match(styles, /\.mexo-option-scroll-area\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;[\s\S]*?scrollbar-gutter:\s*stable;/);
  assert.match(styles, /\.currency-picker-grid\s*\{[\s\S]*?padding:\s*8px;/);
  assert.match(styles, /\.import-platform-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(260px,\s*100%\),\s*1fr\)\)/);
});

test("aggregate overview metrics use scoped stacked label and value styling", async () => {
  const [view, styles] = await Promise.all([
    readSource("src/components/WorkspaceRouteViews.tsx"),
    readSource("src/app/globals.css"),
  ]);

  assert.match(view, /workspace-performance-metric-grid portfolio-scope-overview-metrics mt-5/);
  assert.match(styles, /\.portfolio-scope-overview-metrics\s*\{[^}]*display:\s*grid/);
  assert.match(styles, /\.portfolio-scope-overview-metrics > article > span\s*\{[^}]*display:\s*block/);
  assert.match(styles, /\.portfolio-scope-overview-metrics > article > strong\s*\{[^}]*display:\s*block/);
  assert.match(styles, /\.portfolio-scope-overview-metrics > article > strong\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  assert.match(styles, /\.portfolio-scope-overview-metrics > article > strong:not\(\.tone-positive\):not\(\.tone-negative\)\s*\{[^}]*color:\s*var\(--text\)/);
});

test("dividend payment columns have a complete fixed-table budget", async () => {
  const styles = await readSource("src/app/globals.css");

  assert.match(styles, /\.dividend-payments-table \{\s*min-width:\s*1200px;/);
  assert.match(styles, /\.dividend-payments-column-instrument \{ width: 19%; \}/);
  assert.match(styles, /\.dividend-payments-column-account \{ width: 13%; \}/);
  assert.match(styles, /\.dividend-payments-column-dates \{ width: 16%; \}/);
  assert.match(styles, /\.dividend-payments-column-net \{ width: 13%; \}/);
  assert.match(styles, /\.dividend-payments-column-actions \{ width: 13%; \}/);
});

test("current positions omit the quote column and keep desktop-sized column budgets", async () => {
  const table = await readSource("src/components/AssetTable.tsx");
  const styles = await readSource("src/app/globals.css");

  assert.doesNotMatch(table, /<th>Notowanie<\/th>/);
  assert.doesNotMatch(table, /portfolio-column-quote/);
  assert.match(table, /colSpan=\{10\}/);
  assert.match(styles, /\.portfolio-positions-table \{[\s\S]*?min-width:\s*1028px;/);
  assert.doesNotMatch(styles, /\.portfolio-positions-table \.portfolio-column-quote/);
  assert.match(
    styles,
    /@media \(min-width: 861px\) and \(max-width: 1419px\) \{[\s\S]*?\.portfolio-positions-table \{\s*min-width:\s*964px;/
  );
  assert.match(
    styles,
    /\.portfolio-positions-table \.portfolio-cell-kind \{\s*display:\s*none;/
  );
});

test("OpenFIGI transport retains TLS verification while local Node uses the system trust store", async () => {
  const source = await readSource("src/lib/server/openfigi.ts");
  const packageJson = await readSource("package.json");

  assert.match(packageJson, /node --use-system-ca/);
  assert.match(source, /fetcher: FetchLike = fetchOpenFigiWithSystemTrust/);
  assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/);
});

test("a verified ETF can continue with its historical transaction price after quote failure", async () => {
  const source = await readSource("src/components/PortfolioApp.tsx");

  assert.match(
    source,
    /if \(draft\.kind === "etf"\) \{[\s\S]*?Mozesz dodac ETF z cena transakcji\.[\s\S]*?return null;/
  );
});

test("results panel renders the newest raw daily movement separately from historical day metrics", async () => {
  const metrics = await readSource("src/lib/portfolio-daily-metrics.ts");
  const panel = await readSource("src/components/PortfolioPerformanceResults.tsx");

  assert.match(metrics, /const latestRaw = dailyPoints\.at\(-1\) \?\? null/);
  assert.match(panel, /Ostatnia zmiana wartości/);
  assert.match(panel, /metrics\.latestRaw\.rawValueChangePln/);
  assert.match(panel, /Najlepszy dzień/);
  assert.match(panel, /Najlepszy wynik dzienny/);
});
