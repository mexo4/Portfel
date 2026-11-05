import assert from "node:assert/strict";
import test from "node:test";
import {
  isPortfolioOperationTargetCurrent,
  resolvePortfolioOperationTarget,
} from "../src/lib/portfolio-operation-target.ts";

const portfolios = [
  { id: "pln", name: "PLN" },
  { id: "usd", name: "USD" },
  { id: "ike", name: "IKE" },
];

test("aggregate operation target requires an explicit selection", () => {
  assert.deepEqual(resolvePortfolioOperationTarget({
    portfolios,
    selectedPortfolioIds: ["pln", "usd"],
    isAggregate: true,
    targetPortfolioId: "",
    activePortfolioId: "pln",
  }), { ok: false, reason: "TARGET_REQUIRED" });
});

test("aggregate operation target resolves only inside the selected scope", () => {
  const scope = ["pln", "ike"];
  assert.equal(resolvePortfolioOperationTarget({
    portfolios,
    selectedPortfolioIds: scope,
    isAggregate: true,
    targetPortfolioId: "ike",
    activePortfolioId: "usd",
  }).portfolio.id, "ike");
  assert.deepEqual(resolvePortfolioOperationTarget({
    portfolios,
    selectedPortfolioIds: scope,
    isAggregate: true,
    targetPortfolioId: "usd",
    activePortfolioId: "pln",
  }), { ok: false, reason: "TARGET_OUT_OF_SCOPE" });
});

test("single-portfolio writes use the active portfolio, not an aggregate draft target", () => {
  assert.equal(resolvePortfolioOperationTarget({
    portfolios,
    selectedPortfolioIds: ["usd"],
    isAggregate: false,
    targetPortfolioId: "pln",
    activePortfolioId: "usd",
  }).portfolio.id, "usd");
});

test("async writes are rejected when target or scope changes before commit", () => {
  const stable = {
    targetPortfolioId: "pln",
    currentTargetPortfolioId: "pln",
    targetPortfolioIds: ["pln", "usd"],
    originalScopeKey: "CUSTOM:pln,usd",
    currentScopeKey: "CUSTOM:pln,usd",
  };
  assert.equal(isPortfolioOperationTargetCurrent(stable), true);
  assert.equal(isPortfolioOperationTargetCurrent({
    ...stable,
    currentTargetPortfolioId: "usd",
  }), false);
  assert.equal(isPortfolioOperationTargetCurrent({
    ...stable,
    currentScopeKey: "ALL:pln,usd,ike",
  }), false);
  assert.equal(isPortfolioOperationTargetCurrent({
    ...stable,
    targetPortfolioIds: ["usd", "ike"],
  }), false);
});
