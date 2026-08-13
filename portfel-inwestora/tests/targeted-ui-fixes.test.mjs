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

test("average purchase and unit-price cells preserve normal monetary spacing", async () => {
  const styles = await readSource("src/app/globals.css");
  const selector = styles.match(
    /\.portfolio-positions-table td:nth-child\(4\) \.financial-value,[\s\S]*?\.portfolio-positions-table td:nth-child\(5\) \.financial-value \{([\s\S]*?)\n\}/
  );

  assert.ok(selector);
  assert.match(selector[1], /letter-spacing: normal/);
  assert.match(selector[1], /word-spacing: normal/);
  assert.doesNotMatch(selector[1], /letter-spacing:\s*-/);
  assert.doesNotMatch(selector[1], /word-spacing:\s*-/);
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
