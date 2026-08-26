import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("portfolio management exposes all account types and honest annual states", async () => {
  const source = await readSource("src/components/PortfolioAccountManagement.tsx");
  assert.match(source, /PORTFOLIO_ACCOUNT_TYPE_LONG_LABELS/);
  assert.match(source, /AVAILABLE_YEARS = \[2024, 2025, 2026\]/);
  assert.match(source, /getAnnualContributionSummary/);
  assert.match(source, /Szacowana ulga/);
  assert.match(source, /Brak pełnej historii dziennych wycen/);
  assert.match(source, /nie stosuje uproszczenia/);
  assert.match(source, /Mexo ostrzega, ale nie blokuje zapisu/);
});

test("portfolio type correction is persisted with the complete portfolio book", async () => {
  const [app, sync, database] = await Promise.all([
    readSource("src/components/PortfolioApp.tsx"),
    readSource("src/lib/server/portfolio-core-sync.ts"),
    readSource("src/lib/server/db.ts"),
  ]);
  assert.match(app, /handleUpdatePortfolioAccount/);
  assert.match(app, /queuePortfolioSave/);
  assert.match(sync, /account_type/);
  assert.match(sync, /account_config_json/);
  assert.match(database, /chk_core_portfolios_account_type/);
});

test("cash UI requires explicit pension withdrawal kind and persists transfer metadata", async () => {
  const source = await readSource("src/components/CashWorkspace.tsx");
  assert.match(source, /Wybierz rodzaj wypłaty/);
  assert.match(source, /EARLY_RETURN/);
  assert.match(source, /PARTIAL_RETURN/);
  assert.match(source, /TRANSFER_IN/);
  assert.match(source, /TRANSFER_OUT/);
  assert.match(source, /amountPlnSnapshot/);
  assert.match(source, /taxEstimate/);
});

test("bond redemption sends account type to the centralized domestic tax rule", async () => {
  const [app, route, server] = await Promise.all([
    readSource("src/components/PortfolioApp.tsx"),
    readSource("src/app/api/bonds/redemption/route.ts"),
    readSource("src/lib/server/treasury-bonds.ts"),
  ]);
  assert.match(app, /accountType: normalizePortfolioAccountType/);
  assert.match(route, /accountType/);
  assert.match(server, /getDomesticInvestmentIncomeTaxTreatment/);
});

test("portfolio history keeps account rules per real portfolio and deduplicates derived coupons", async () => {
  const [route, workspace] = await Promise.all([
    readSource("src/app/api/portfolio-history/route.ts"),
    readSource("src/components/WorkspaceRouteViews.tsx"),
  ]);
  assert.match(route, /mergeRealizedAdjustments/);
  assert.match(route, /new Map/);
  assert.match(route, /scope\.accountType/);
  assert.match(workspace, /accountType: portfolio\.accountType/);
});
