import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteAdministrator, MAX_ACCOUNT_EXPORT_ROWS_PER_DATASET, MAX_ACCOUNT_EXPORT_TOTAL_ROWS, MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES } from "../src/lib/account-lifecycle.ts";
import { buildOperationsCsv, createExportManifest, PRIVACY_EXPORT_VERSION, stripAutomaticQuotesFromLegacyPortfolio } from "../src/lib/privacy-export.ts";
import { resolveLegalDocument } from "../src/lib/legal-documents.ts";
import { isSameOriginMutation } from "../src/lib/server/account-deletion-http.ts";
import { AUTH_RATE_LIMIT_POLICIES } from "../src/lib/server/auth-rate-limit.ts";
import { isRecentGoogleAuthentication } from "../src/lib/server/oauth.ts";

test("portable CSV preserves Unicode and quoting while preventing spreadsheet formulas", () => {
  const csv = buildOperationsCsv([{
    id: "operacja-ą",
    operation_type: "DYVIDENDA",
    notes: '=HYPERLINK("https://bad.invalid")',
    amount: -12.5,
    currency: "PLN",
    metadata_json: '{"uwaga":"żółć, \\\"tekst\\\""}',
  }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"'=?HYPERLINK/);
  assert.match(csv, /"-12\.5"/);
  assert.match(csv, /operacja-ą/);
  assert.match(csv, /żółć/);
  assert.match(csv, /""/);
});

test("legacy portfolio export excludes provider quotes but retains explicitly manual prices and transactions", () => {
  const portfolio = {
    schemaVersion: 2,
    activePortfolioId: "portfolio-1",
    portfolios: [{
      id: "portfolio-1",
      assets: [
        { id: "automatic", symbol: "AAA", latestPrice: 123, previousClose: 120, priceSource: "AUTOMATIC", quantity: 2 },
        { id: "legacy-automatic", symbol: "BBB", latestPrice: 9.5, latestPriceFetchedAt: "2026-11-08T10:00:00Z", quantity: 3 },
        { id: "manual", symbol: "CCC", latestPrice: 4.25, priceSource: "MANUAL", quantity: 4 },
      ],
      operations: [{ id: "op-1", amount: "-1200.123456789" }],
    }],
  };
  const result = stripAutomaticQuotesFromLegacyPortfolio(portfolio);
  assert.equal(result.portfolios[0].assets[0].latestPrice, undefined);
  assert.equal(result.portfolios[0].assets[0].quantity, 2);
  assert.equal(result.portfolios[0].assets[1].latestPrice, undefined);
  assert.equal(result.portfolios[0].assets[2].latestPrice, 4.25);
  assert.equal(result.portfolios[0].assets[2].priceSource, "MANUAL");
  assert.deepEqual(result.portfolios[0].operations, portfolio.portfolios[0].operations);
});

test("CSV formula protection preserves exact negative and positive numeric strings", () => {
  const csv = buildOperationsCsv([
    { id: "negative", amount: "-1200.123456789012345" },
    { id: "positive", amount: "+12.50" },
    { id: "formula", notes: "-1+cmd|' /C calc'!A0" },
    { id: "unicode-formula", notes: "\uFEFF=HYPERLINK(\"https://bad.invalid\")" },
  ]);
  assert.match(csv, /"-1200\.123456789012345"/);
  assert.match(csv, /"\+12\.50"/);
  assert.match(csv, /"'-1\+cmd/);
  assert.match(csv, /"'\uFEFF=HYPERLINK/);
});

test("export manifest identifies scope, version, encoding and explicit exclusions", () => {
  const manifest = createExportManifest("2026-11-08T12:00:00.000Z", {
    exportId: "export-test",
    files: { "operations.csv": { records: 17, bytes: 1024 } },
  });
  assert.equal(manifest.version, PRIVACY_EXPORT_VERSION);
  assert.equal(manifest.schemaVersion, PRIVACY_EXPORT_VERSION);
  assert.equal(manifest.exportId, "export-test");
  assert.equal(manifest.createdAt, "2026-11-08T12:00:00.000Z");
  assert.deepEqual(manifest.files, [{ path: "operations.csv", records: 17, bytes: 1024 }]);
  assert.match(manifest.fileListNote, /self-referential/);
  assert.match(manifest.currencies, /original stored currency/);
  assert.ok(manifest.exclusions.some((entry) => entry.includes("session")));
  assert.ok(manifest.exclusions.some((entry) => entry.includes("Shared market")));
});

test("export resource ceilings are explicit and administrator deletion requires a successor", () => {
  assert.equal(canDeleteAdministrator("user", 0), true);
  assert.equal(canDeleteAdministrator("admin", 1), false);
  assert.equal(canDeleteAdministrator("admin", 2), true);
  assert.equal(MAX_ACCOUNT_EXPORT_ROWS_PER_DATASET, 50_000);
  assert.equal(MAX_ACCOUNT_EXPORT_TOTAL_ROWS, 100_000);
  assert.equal(MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES, 32 * 1024 * 1024);
});

test("exports are rate-limited per account and Google deletion step-up requires a fresh claim", () => {
  assert.deepEqual(AUTH_RATE_LIMIT_POLICIES.accountExport, { limit: 4, identityLimit: 2, windowMs: 60 * 60_000 });
  assert.deepEqual(AUTH_RATE_LIMIT_POLICIES.accountDeletion, { limit: 8, identityLimit: 8, windowMs: 60 * 60_000 });
  const now = Math.floor(Date.now() / 1_000);
  assert.equal(isRecentGoogleAuthentication(now, now * 1_000, now), true);
  assert.equal(isRecentGoogleAuthentication(now - 301, now * 1_000, now), false);
  assert.equal(isRecentGoogleAuthentication(undefined, now * 1_000, now), false);
});

test("public legal routes resolve to explicitly marked drafts until approved content exists", () => {
  for (const kind of ["privacy", "terms"]) {
    const resolved = resolveLegalDocument(kind);
    assert.equal(resolved.status, "draft");
    assert.equal(resolved.document.status, "draft");
    assert.equal(resolved.approval, null);
    assert.ok(resolved.document.sections.some((section) => section.paragraphs.some((paragraph) => paragraph.includes("DO UZUPEŁNIENIA"))));
  }
});

test("destructive API mutations require exact same-origin and reject cross-site metadata", () => {
  const same = new Request("http://localhost:3000/api/account", { method: "DELETE", headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" } });
  const forged = new Request("http://localhost:3000/api/account", { method: "DELETE", headers: { origin: "https://attacker.invalid", "sec-fetch-site": "cross-site" } });
  const missing = new Request("http://localhost:3000/api/account", { method: "DELETE" });
  assert.equal(isSameOriginMutation(same), true);
  assert.equal(isSameOriginMutation(forged), false);
  assert.equal(isSameOriginMutation(missing), false);
});
