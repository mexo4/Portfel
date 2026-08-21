import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getGeographicAllocation } from "../src/lib/geographic-allocation.ts";
import { DEFAULT_PERFORMANCE_METRICS, normalizePerformanceMetricIds } from "../src/lib/performance-preferences.ts";

const group = ({ key, symbol, provider = "stooq", currency = "PLN", country, kind = "stock", value = 100 }) => ({ key, kind, totalValue: value, lots: [{ symbol, provider, providerId: symbol, marketCurrency: currency, issuerCountry: country }] });

test("geographic exposure recognizes legacy GPW broadly but explicit issuer metadata wins", () => {
  const result = getGeographicAllocation([
    group({ key: "dnp", symbol: "DNP.WA", value: 100 }),
    group({ key: "pkn", symbol: "PKN.PL", value: 200 }),
    group({ key: "foreign-gpw", symbol: "XYZ.WA", country: "Netherlands", value: 30 }),
    group({ key: "usa", symbol: "AAPL.US", provider: "eodhd", currency: "USD", country: "United States", value: 50 }),
    group({ key: "unknown", symbol: "UNKNOWN", provider: "yahoo", currency: "EUR", value: 20 }),
    group({ key: "etf", symbol: "ETFBDIVPL.WA", kind: "etf", value: 900 }),
  ]);
  assert.deepEqual(result, [{ country: "Polska", totalValue: 300 }, { country: "USA", totalValue: 50 }, { country: "Netherlands", totalValue: 30 }, { country: "Inne / Brak danych", totalValue: 20 }]);
});

test("all-portfolios geographic input remains additive and ETFs stay excluded", () => {
  assert.deepEqual(getGeographicAllocation([group({ key: "a:dnp", symbol: "DNP.WA", value: 120 }), group({ key: "b:lpp", symbol: "LPP.WA", value: 80 }), group({ key: "b:etf", symbol: "VWCE.DE", kind: "etf", currency: "EUR", value: 500 })]), [{ country: "Polska", totalValue: 200 }]);
});

test("performance preferences keep a non-empty known and deduplicated metric set", () => {
  assert.deepEqual(normalizePerformanceMetricIds(["best-day", "best-day", "unknown"]), ["best-day"]);
  assert.deepEqual(normalizePerformanceMetricIds([]), DEFAULT_PERFORMANCE_METRICS);
});

test("results distinguish loading, errors and empty data and persist preferences", async () => {
  const [panel, route, store, db] = await Promise.all([readFile(new URL("../src/components/PortfolioPerformanceResults.tsx", import.meta.url), "utf8"), readFile(new URL("../src/app/api/performance-preferences/route.ts", import.meta.url), "utf8"), readFile(new URL("../src/lib/server/performance-preferences.ts", import.meta.url), "utf8"), readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8")]);
  assert.match(panel, /isHistoryLoading/); assert.match(panel, /Wczytywanie…/); assert.match(panel, /historyError/); assert.match(panel, /Brak danych/);
  assert.match(route, /getCurrentAuthenticatedUser/); assert.match(store, /ON CONFLICT \(user_id\)/); assert.match(db, /CREATE TABLE IF NOT EXISTS user_performance_preferences/);
});

test("cash stays behind the admin role and Tester bypass is centralized", async () => {
  const [income, client, server, constants] = await Promise.all([readFile(new URL("../src/components/PortfolioIncomeWorkspace.tsx", import.meta.url), "utf8"), readFile(new URL("../src/components/PortfolioApp.tsx", import.meta.url), "utf8"), readFile(new URL("../src/lib/server/auth.ts", import.meta.url), "utf8"), readFile(new URL("../src/lib/constants.ts", import.meta.url), "utf8")]);
  assert.match(income, /props\.isAdmin \? <button[\s\S]*Gotówka/); assert.match(income, /const activeView = props\.isAdmin \? view : "dividends"/);
  assert.match(constants, /MEXO_TESTER_MODE = true/); assert.match(client, /MEXO_TESTER_MODE \|\|/); assert.match(server, /MEXO_TESTER_MODE \|\|/);
});

test("watchlist page reuses GPW stock search and canonical toggle", async () => {
  const source = await readFile(new URL("../src/components/WatchlistWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /searchAssets\(\{ query: trimmed, kind: "stock", mode: "stock-gpw"/); assert.match(source, /workspace\.onToggleWatchlistItem\(result\)/); assert.match(source, /getGpwWatchlistCanonicalKey\(result\.symbol\)/);
});

test("long top-position names use a constrained accessible ellipsis", async () => {
  const [component, styles] = await Promise.all([readFile(new URL("../src/components/PortfolioCharts.tsx", import.meta.url), "utf8"), readFile(new URL("../src/app/globals.css", import.meta.url), "utf8")]);
  assert.match(component, /<TruncatedText[\s\S]*text=\{`\$\{asset\.name\} \(\$\{asset\.symbol\}\)`\}/); assert.match(styles, /\.chart-row-copy > div \{[\s\S]*?flex: 1 1 auto;[\s\S]*?width: 0;/); assert.match(styles, /\.chart-row-copy > strong \{[\s\S]*?white-space: nowrap;/);
});
