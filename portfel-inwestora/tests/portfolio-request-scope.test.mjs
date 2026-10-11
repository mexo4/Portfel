import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAccountOwnedByPortfolio, resolveRequestedPortfolio } from "../src/lib/server/portfolio-request-scope.ts";

const portfolios = [{ id: "pln", name: "PLN" }, { id: "usd", name: "USD" }];

test("portfolio request uses an explicit owned portfolio and default only when omitted", () => {
  assert.equal(resolveRequestedPortfolio(portfolios, "usd", "pln")?.id, "usd");
  assert.equal(resolveRequestedPortfolio(portfolios, null, "pln")?.id, "pln");
  assert.equal(resolveRequestedPortfolio(portfolios, undefined, "missing")?.id, "pln");
});

test("an invalid explicit portfolio never silently falls back to another account", () => {
  assert.equal(resolveRequestedPortfolio(portfolios, "deleted-portfolio", "pln"), null);
  assert.equal(resolveRequestedPortfolio(portfolios, "   ", "pln"), null);
});

test("cash and dividend account IDs must belong to the selected real portfolio", () => {
  assert.equal(isAccountOwnedByPortfolio({ portfolioId: "pln" }, "pln"), true);
  assert.equal(isAccountOwnedByPortfolio({ portfolioId: "usd" }, "pln"), false);
  assert.equal(isAccountOwnedByPortfolio(undefined, "pln"), false);
});

test("income workspace remounts on scope change and blocks stale cross-portfolio drafts", async () => {
  const [portfolioApp, cashUi, dividendUi, operationsApi, dividendsApi, dividendByIdApi] = await Promise.all([
    readFile(new URL("../src/components/PortfolioApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CashWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DividendCashWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/portfolio/v2/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/portfolio/v2/dividends/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/portfolio/v2/dividends/[dividendId]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(portfolioApp, /<PortfolioIncomeWorkspace key=\{incomeScopeKey\}/);
  assert.match(portfolioApp, /active:\$\{activePortfolioId\}/);
  assert.match(cashUi, /selectedSourceAccount\.portfolioId !== selectedPortfolio\.id/);
  assert.match(cashUi, /isPortfolioMutationPending/);
  assert.match(dividendUi, /account\.portfolioId !== portfolio\.id \|\| instrument\.portfolioId !== portfolio\.id/);
  for (const api of [operationsApi, dividendsApi, dividendByIdApi]) {
    assert.match(api, /resolveRequestedPortfolio/);
  }
  assert.match(operationsApi, /Wybrane konto nie należy do wskazanego portfela/);
  assert.match(dividendsApi, /Konto wpływu nie należy do wskazanego portfela/);
});
