import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_PORTFOLIOS_ID,
  CUSTOM_PORTFOLIOS_ID,
  getAuthorizedPortfolioScopeIds,
  getPortfolioScopeIds,
  getPortfolioScopeLabel,
  getWorkspaceReadHref,
  normalizePortfolioScope,
  parsePortfolioScope,
} from "../src/lib/portfolio-selection.ts";

const ids = ["xtb", "crypto", "ike"];

test("portfolio scope resolves ALL, SINGLE and two-of-three CUSTOM selections", () => {
  assert.deepEqual(parsePortfolioScope(new URLSearchParams("portfolio=all"), ids), { mode: "ALL" });
  assert.deepEqual(parsePortfolioScope(new URLSearchParams("portfolio=ike"), ids), { mode: "SINGLE", portfolioId: "ike" });
  const custom = parsePortfolioScope(new URLSearchParams("portfolio=custom&portfolios=xtb%2Cike"), ids);
  assert.deepEqual(custom, { mode: "CUSTOM", portfolioIds: ["xtb", "ike"] });
  assert.deepEqual(getPortfolioScopeIds(custom, ids), ["xtb", "ike"]);
  assert.equal(getPortfolioScopeLabel(custom, ids.map((id) => ({ id, name: id.toUpperCase() }))), "2 portfeli");
  assert.equal(ALL_PORTFOLIOS_ID, "__mexo_all_portfolios__");
  assert.equal(CUSTOM_PORTFOLIOS_ID, "__mexo_custom_portfolios__");
});

test("scope normalization removes deleted IDs and never permits an empty committed selection", () => {
  assert.deepEqual(normalizePortfolioScope({ mode: "CUSTOM", portfolioIds: ["xtb", "deleted"] }, ids), { mode: "SINGLE", portfolioId: "xtb" });
  assert.deepEqual(normalizePortfolioScope({ mode: "CUSTOM", portfolioIds: ["deleted"] }, ids), { mode: "ALL" });
  assert.deepEqual(normalizePortfolioScope({ mode: "CUSTOM", portfolioIds: ids }, ids), { mode: "ALL" });
});

test("portfolio scope URLs preserve all/custom context and display currency across routes", () => {
  assert.equal(getWorkspaceReadHref("/analytics/charts", ALL_PORTFOLIOS_ID, "USD", { mode: "ALL" }), "/analytics/charts?portfolio=all&currency=USD");
  assert.equal(getWorkspaceReadHref("/analytics/charts", CUSTOM_PORTFOLIOS_ID, "EUR", { mode: "CUSTOM", portfolioIds: ["xtb", "ike"] }), "/analytics/charts?portfolio=custom&portfolios=xtb%2Cike&currency=EUR");
  assert.equal(getWorkspaceReadHref("/analytics/charts", "ike", "PLN", { mode: "SINGLE", portfolioId: "ike" }), "/analytics/charts?portfolio=ike");
});

test("aggregate history and API scope authorization reject foreign and oversized IDs", () => {
  assert.deepEqual(getAuthorizedPortfolioScopeIds(["own", "own"], ["own", "other"]), ["own"]);
  assert.equal(getAuthorizedPortfolioScopeIds(["other"], ["own", "other"].filter((id) => id === "own")), null);
  assert.equal(getAuthorizedPortfolioScopeIds(Array.from({ length: 51 }, (_, index) => `p${index}`), Array.from({ length: 51 }, (_, index) => `p${index}`)), null);
});
