import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getUserFacingHistoryWarnings } from "../src/lib/history-warning-visibility.ts";
import { getGroupedPortfolioAssets } from "../src/lib/portfolio-engine.ts";
import { sortPortfolioAssetGroups } from "../src/lib/portfolio-position-sort.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const makeAsset = ({ id, latestPrice, previousClose }) => ({
  id,
  name: `Pozycja ${id}`,
  symbol: id.toUpperCase(),
  kind: "stock",
  purchaseDate: "2026-08-01",
  quantity: 10,
  purchasePrice: 100,
  purchaseCurrency: "USD",
  purchasePriceCurrency: "USD",
  purchaseFxRateToPln: 4,
  feePln: 0,
  marketCurrency: "USD",
  provider: "catalog",
  latestPrice,
  previousClose,
  createdAt: "2026-08-01T00:00:00.000Z",
});

test("position daily result uses the existing quote snapshot and base-currency conversion", () => {
  const [group] = getGroupedPortfolioAssets(
    [makeAsset({ id: "up", latestPrice: 105, previousClose: 100 })],
    { PLN: 1, USD: 4 },
    "PLN"
  );

  assert.equal(group.dailyChangeBase, 200);
  assert.equal(group.dailyChangePercent, 5);
});

test("daily and total-percent sorts keep missing data after positive, zero and negative values", () => {
  const groups = getGroupedPortfolioAssets(
    [
      makeAsset({ id: "up", latestPrice: 105, previousClose: 100 }),
      makeAsset({ id: "flat", latestPrice: 100, previousClose: 100 }),
      makeAsset({ id: "down", latestPrice: 95, previousClose: 100 }),
      makeAsset({ id: "missing", latestPrice: 110, previousClose: undefined }),
    ],
    { PLN: 1, USD: 4 },
    "PLN"
  );

  assert.deepEqual(
    sortPortfolioAssetGroups(groups, "daily-gain-desc").map((group) => group.symbol),
    ["UP", "FLAT", "DOWN", "MISSING"]
  );
  assert.deepEqual(
    sortPortfolioAssetGroups(groups, "daily-loss-asc").map((group) => group.symbol),
    ["DOWN", "FLAT", "UP", "MISSING"]
  );
  assert.deepEqual(
    sortPortfolioAssetGroups(groups, "profit-percent-desc").map((group) => group.symbol),
    ["MISSING", "UP", "FLAT", "DOWN"]
  );
  assert.deepEqual(
    sortPortfolioAssetGroups(groups, "profit-percent-asc").map((group) => group.symbol),
    ["DOWN", "FLAT", "UP", "MISSING"]
  );
});

test("successful history fallbacks stay diagnostic while actionable errors remain visible", () => {
  assert.deepEqual(
    getUserFacingHistoryWarnings([
      "Nie udalo sie pobrac pelnej historii cen dla ISAC.UK; uzyto fallbacku z danych zakupu.",
      "Historia ISLN.UK ma braki na poczatku zakresu; brakujace dni wyceniono po cenie zakupu.",
      "Brak kursu walutowego USD/PLN uniemozliwia wiarygodna wycene.",
    ]),
    ["Brak kursu walutowego USD/PLN uniemozliwia wiarygodna wycene."]
  );
});

test("daily chart, positions and navigation expose the shared responsive UI mechanisms", async () => {
  const [charts, table, cards, shell, styles] = await Promise.all([
    readSource("src/components/PortfolioLineCharts.tsx"),
    readSource("src/components/AssetTable.tsx"),
    readSource("src/components/PortfolioPositionCards.tsx"),
    readSource("src/components/AppWorkspaceShell.tsx"),
    readSource("src/app/globals.css"),
  ]);

  assert.match(charts, /renderDailyInvestmentResultChart\s*=\s*\(isFullscreen = false\)/);
  assert.match(charts, /onDoubleClick=\{\(\) => \{[\s\S]*?handleOpenChartModal\(\)/);
  assert.match(charts, /renderDailyInvestmentResultChart\(true\)/);
  assert.match(charts, /renderRangeSelector\(true\)/);
  assert.match(charts, /isFullscreen=\{isFullscreen\}/);
  assert.match(table, /<th className="portfolio-cell-daily-result">Wynik dzienny<\/th>/);
  assert.match(table, /<th className="portfolio-cell-daily-percent">Zmiana dzienna %<\/th>/);
  assert.match(cards, /<dt>Wynik dzienny<\/dt>/);
  assert.match(cards, /<dt>Zmiana dzienna %<\/dt>/);
  assert.match(shell, /type WorkspaceIconName/);
  assert.match(shell, /<WorkspaceIcon name=\{item\.icon\}/);
  assert.doesNotMatch(shell, /glyph:/);
  assert.match(styles, /\.portfolio-positions-table \.portfolio-number/);
  assert.match(styles, /\.workspace-icon/);
});
