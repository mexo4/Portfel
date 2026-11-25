import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { findPortfolioPlanLimitViolation } = await import("../src/lib/portfolio-plan-limits.ts");

const free = { subscriptionPlan: "free", subscriptionStatus: "active", subscriptionExpiresAt: null, role: "user", testerAccess: false, espiAccess: false };
const asset = (symbol) => ({ id: symbol, symbol, name: symbol, kind: "stock", provider: "stooq", purchaseCurrency: "PLN", marketCurrency: "PLN", quantity: 1, purchasePrice: 10 });
const portfolio = (id, assetCount = 0) => ({ id, name: id, assets: Array.from({ length: assetCount }, (_, index) => asset(`A${index}`)) });
const book = (...portfolios) => ({ portfolios });

test("a Free account that already has two portfolios can still save changes", () => {
  const stored = book(portfolio("p1", 3), portfolio("p2", 1));
  assert.equal(findPortfolioPlanLimitViolation(free, stored, book(portfolio("p1", 3), portfolio("p2", 1))), null);
  assert.equal(findPortfolioPlanLimitViolation(free, stored, book(portfolio("p1", 2), portfolio("p2", 1))), null, "removing a position is fine");
});

test("a Free account cannot add another portfolio", () => {
  assert.match(findPortfolioPlanLimitViolation(free, book(portfolio("p1")), book(portfolio("p1"), portfolio("p2"))), /kolejnego portfela/);
  assert.match(findPortfolioPlanLimitViolation(free, book(portfolio("p1"), portfolio("p2")), book(portfolio("p1"), portfolio("p2"), portfolio("p3"))), /kolejnego portfela/);
});

test("a Free account cannot grow a portfolio past the position limit", () => {
  assert.match(findPortfolioPlanLimitViolation(free, book(portfolio("p1", 99)), book(portfolio("p1", 100))), /99 pozycji/);
  assert.equal(findPortfolioPlanLimitViolation(free, book(portfolio("p1", 98)), book(portfolio("p1", 99))), null);
});

test("testers are not limited", () => {
  assert.equal(findPortfolioPlanLimitViolation({ ...free, testerAccess: true }, book(portfolio("p1")), book(portfolio("p1"), portfolio("p2"))), null);
});

test("the save compares against the stored book read on the locked row, not the light user read", () => {
  const source = readFileSync(new URL("../src/lib/server/auth.ts", import.meta.url), "utf8");
  const save = source.slice(source.indexOf("export const updateCurrentUserPortfolio"), source.indexOf("export const updateCurrentUserSubscription"));
  assert.match(save, /tester_access, espi_access, portfolio_json\s+FROM users WHERE id = \$1 FOR UPDATE/);
  assert.match(save, /parsePortfolioBook\(currentUser\.portfolio_json/);
  assert.doesNotMatch(save, /existingUser\.portfolio_json/, "getUserById returns an empty portfolio_json");
});
