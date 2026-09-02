import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("login enters the dashboard directly without the legacy app redirect", async () => {
  const [authCard, loginPage, registerPage, googleCallback] = await Promise.all([
    readSource("src/components/AuthCard.tsx"),
    readSource("src/app/login/page.tsx"),
    readSource("src/app/register/page.tsx"),
    readSource("src/app/api/auth/oauth/google/callback/route.ts"),
  ]);

  assert.match(authCard, /window\.location\.replace\("\/dashboard"\)/);
  assert.doesNotMatch(authCard, /window\.location\.replace\("\/app"\)/);
  assert.match(loginPage, /redirect\("\/dashboard"\)/);
  assert.match(registerPage, /redirect\("\/dashboard"\)/);
  assert.match(googleCallback, /getOAuthApplicationUrl\("\/dashboard"\)/);
});

test("database access is request-scoped and Hyperdrive owns connection pooling", async () => {
  const database = await readSource("src/lib/server/db.ts");

  assert.match(database, /import\("cloudflare:workers"\)/);
  assert.match(database, /new Client\(await getClientConfiguration\(\)\)/);
  assert.match(database, /await client\.end\(\)/);
  assert.match(database, /pg_advisory_xact_lock/);
  assert.match(database, /schemaStatements\.map\(\(statement\)/);
  assert.doesNotMatch(database, /\bPool\b/);
  assert.doesNotMatch(database, /globalThis\.portfel/);
  assert.doesNotMatch(database, /client\.release\(\)/);
});

test("broker import persists first and leaves quotes to the shared background refresh", async () => {
  const portfolioApp = await readSource("src/components/PortfolioApp.tsx");
  const start = portfolioApp.indexOf("const handleImportBrokerOperations");
  const end = portfolioApp.indexOf("const handleAddRealizedAdjustment", start);
  const importHandler = portfolioApp.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(importHandler, /await queuePortfolioSave/);
  assert.match(importHandler, /applyPortfolioBook\(nextPortfolios/);
  assert.match(importHandler, /foreignImportCurrencies/);
  assert.doesNotMatch(importHandler, /refreshPortfolioQuotesWithProgress\(/);
});

test("transaction entry explains that Mexo records rather than places orders", async () => {
  const [form, shell, positions] = await Promise.all([
    readSource("src/components/AddAssetForm.tsx"),
    readSource("src/components/AppWorkspaceShell.tsx"),
    readSource("src/components/WorkspaceRouteViews.tsx"),
  ]);

  assert.match(form, /Dodaj transakcj\u0119 do portfela/);
  assert.match(form, /Mexo nie sk\u0142ada zlece\u0144 gie\u0142dowych/);
  assert.match(form, /:\s*"Kup"\}/);
  assert.match(form, />\s*Sprzedaj\s*</);
  assert.match(shell, /Dodaj transakcj\u0119/);
  assert.match(positions, /Dodaj transakcj\u0119/);
});

test("dashboard and import routes avoid the all-routes client barrel", async () => {
  const [dashboardPage, importPage, portfolioApp] = await Promise.all([
    readSource("src/app/(workspace)/dashboard/page.tsx"),
    readSource("src/app/(workspace)/portfolio/import/page.tsx"),
    readSource("src/components/PortfolioApp.tsx"),
  ]);

  assert.doesNotMatch(dashboardPage, /WorkspaceRouteViews/);
  assert.doesNotMatch(importPage, /WorkspaceRouteViews/);
  assert.match(portfolioApp, /dynamic\(\(\) => import\("@\/components\/BrokerImportPanel"\)\)/);
});
