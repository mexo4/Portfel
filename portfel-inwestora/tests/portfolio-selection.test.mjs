import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_PORTFOLIOS_ID,
  CUSTOM_PORTFOLIOS_ID,
  arePortfolioScopesEqual,
  getPortfolioScopeSyncAction,
  getPreferredActivePortfolioId,
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
  assert.equal(getWorkspaceReadHref("/analytics/charts", "ike", "USD", { mode: "SINGLE", portfolioId: "ike" }), "/analytics/charts?portfolio=ike&currency=USD");
});

test("scope sync waits for an app navigation to commit before syncing URL back to active state", () => {
  const scopeA = { mode: "SINGLE", portfolioId: "xtb" };
  const scopeB = { mode: "SINGLE", portfolioId: "crypto" };
  const common = {
    lastObservedUrlScope: scopeA,
    pendingScope: scopeB,
    activePortfolioId: "crypto",
    isMutationPending: false,
    portfolioIds: ids,
  };

  assert.equal(getPortfolioScopeSyncAction({ ...common, urlScope: scopeA }), "WAIT");
  assert.equal(
    getPortfolioScopeSyncAction({ ...common, urlScope: scopeB }),
    "ACKNOWLEDGE"
  );
  assert.equal(
    getPortfolioScopeSyncAction({ ...common, urlScope: scopeA, isMutationPending: true }),
    "WAIT"
  );
});

test("external navigation supersedes a pending portfolio scope instead of creating a switchback", () => {
  const pending = { mode: "SINGLE", portfolioId: "crypto" };
  const url = { mode: "SINGLE", portfolioId: "ike" };
  assert.equal(getPortfolioScopeSyncAction({
    urlScope: url,
    lastObservedUrlScope: { mode: "SINGLE", portfolioId: "xtb" },
    pendingScope: pending,
    activePortfolioId: "crypto",
    isMutationPending: false,
    portfolioIds: ids,
  }), "APPLY_URL_SCOPE");
});

test("rapid A to B to A to B selections acknowledge each committed URL without oscillating", () => {
  const scope = (portfolioId) => ({ mode: "SINGLE", portfolioId });
  const decision = (urlId, lastId, pendingId, activeId) => getPortfolioScopeSyncAction({
    urlScope: scope(urlId),
    lastObservedUrlScope: scope(lastId),
    pendingScope: pendingId ? scope(pendingId) : null,
    activePortfolioId: activeId,
    isMutationPending: false,
    portfolioIds: ids,
  });

  assert.equal(decision("xtb", "xtb", "crypto", "crypto"), "WAIT");
  assert.equal(decision("crypto", "xtb", "crypto", "crypto"), "ACKNOWLEDGE");
  assert.equal(decision("crypto", "crypto", null, "crypto"), "NOOP");
  assert.equal(decision("crypto", "crypto", "xtb", "xtb"), "WAIT");
  assert.equal(decision("xtb", "crypto", "xtb", "xtb"), "ACKNOWLEDGE");
  assert.equal(decision("xtb", "xtb", null, "xtb"), "NOOP");
  assert.equal(decision("xtb", "xtb", "crypto", "crypto"), "WAIT");
  assert.equal(decision("crypto", "xtb", "crypto", "crypto"), "ACKNOWLEDGE");
  assert.equal(decision("crypto", "crypto", null, "crypto"), "NOOP");
});

test("a stale 409 active id cannot trigger an automatic save/sync loop", () => {
  const urlScope = { mode: "SINGLE", portfolioId: "xtb" };
  const serverBook = { activePortfolioId: "crypto", portfolioIds: ids };
  const localActiveId = getPreferredActivePortfolioId(
    urlScope,
    serverBook.activePortfolioId,
    serverBook.portfolioIds
  );

  assert.equal(localActiveId, "xtb");
  assert.equal(getPortfolioScopeSyncAction({
    urlScope,
    lastObservedUrlScope: urlScope,
    pendingScope: null,
    activePortfolioId: localActiveId,
    isMutationPending: false,
    portfolioIds: serverBook.portfolioIds,
  }), "NOOP");
});

test("CUSTOM scopes compare as sets and route scope wins over a stale server active id", () => {
  assert.equal(arePortfolioScopesEqual(
    { mode: "CUSTOM", portfolioIds: ["xtb", "ike"] },
    { mode: "CUSTOM", portfolioIds: ["ike", "xtb"] },
    ids
  ), true);
  assert.equal(getPreferredActivePortfolioId(
    { mode: "SINGLE", portfolioId: "ike" },
    "xtb",
    ids
  ), "ike");
  assert.equal(getPreferredActivePortfolioId(
    { mode: "ALL" },
    "deleted",
    ids
  ), "xtb");
  assert.equal(getPreferredActivePortfolioId(
    { mode: "CUSTOM", portfolioIds: ["ike", "crypto"] },
    "crypto",
    ids
  ), "crypto");
});

test("aggregate history and API scope authorization reject foreign and oversized IDs", () => {
  assert.deepEqual(getAuthorizedPortfolioScopeIds(["own", "own"], ["own", "other"]), ["own"]);
  assert.equal(getAuthorizedPortfolioScopeIds(["other"], ["own", "other"].filter((id) => id === "own")), null);
  assert.equal(getAuthorizedPortfolioScopeIds(Array.from({ length: 51 }, (_, index) => `p${index}`), Array.from({ length: 51 }, (_, index) => `p${index}`)), null);
});
