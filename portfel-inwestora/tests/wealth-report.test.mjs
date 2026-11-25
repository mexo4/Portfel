import assert from "node:assert/strict";
import test from "node:test";

const { buildWealthReport } = await import("../src/lib/wealth-report.ts");

const summary = (marketValuePln, cashValuePln, positionsCount) => ({ marketValuePln, cashValuePln, totalValuePln: marketValuePln + cashValuePln, positionsCount });
const item = (fields) => ({ id: fields.name, description: "", annualChangePercent: 0, addedAt: "2026-01-01", currency: "PLN", createdAt: "", updatedAt: "", ...fields });

test("portfolios and wealth items add up to the net worth, grouped by kind", () => {
  const report = buildWealthReport({
    portfolioSummaries: [
      { portfolio: { id: "p1", name: "XTB", accountType: "STANDARD", accounts: [{ kind: "investment", name: "XTB PLN 123" }] }, summary: summary(60_000, 5_000, 12) },
      { portfolio: { id: "p2", name: "IKE", accountType: "IKE", accounts: [] }, summary: summary(20_000, 0, 1) },
      { portfolio: { id: "p3", name: "Krypto", accountType: "STANDARD", accounts: [] }, summary: summary(0, 0, 3) },
    ],
    wealthItems: [
      item({ name: "Mieszkanie", kind: "asset", category: "apartment", value: 500_000 }),
      item({ name: "Lokata", kind: "asset", category: "deposit", value: 1, deposit: { principal: 10_000, startDate: "2026-01-01", termMonths: 12, annualRatePercent: 6, capitalization: "maturity", taxed: true } }),
      item({ name: "Złoto", kind: "asset", category: "gold", value: 1_000, currency: "USD" }),
      item({ name: "Hipoteka", kind: "liability", category: "mortgage", value: 300_000 }),
    ],
    fxRates: { PLN: 1, USD: 4 },
    today: "2027-02-01",
  });

  assert.equal(report.assetsPln, 60_000 + 5_000 + 20_000 + 500_000 + 10_486 + 4_000);
  assert.equal(report.liabilitiesPln, 300_000);
  assert.equal(report.netWorthPln, report.assetsPln - 300_000);
  assert.deepEqual(report.categories.map((category) => category.key), ["property", "investments", "deposits", "broker-cash", "valuables", "liabilities"]);
  assert.equal(report.categories.find((category) => category.key === "deposits").valuePln, 10_486, "a deposit counts with its interest");
  assert.equal(report.places[0].name, "Mieszkanie");
  assert.equal(report.places.find((place) => place.name === "IKE").detail, "Portfel IKE · 1 pozycja");
  assert.equal(report.places.find((place) => place.name === "XTB").detail, "Portfel inwestycyjny · XTB PLN 123 · 12 pozycji");
  assert.equal(report.places.find((place) => place.name === "Krypto").detail, "Portfel inwestycyjny · 3 pozycje");
  assert.equal(report.places.at(-1).isLiability, true, "liabilities are listed last");
});

test("an empty account gives zeros, not NaN", () => {
  const report = buildWealthReport({ portfolioSummaries: [], wealthItems: [], fxRates: { PLN: 1 }, today: "2026-11-25" });

  assert.deepEqual(report, { assetsPln: 0, liabilitiesPln: 0, netWorthPln: 0, categories: [], places: [] });
});
