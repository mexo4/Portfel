import assert from "node:assert/strict";
import test from "node:test";

const { addMonths, buildLoanSchedule, getDepositState, getLoanState, getWealthItemValue } = await import("../src/lib/wealth-instruments.ts");
const { normalizeUserProfile } = await import("../src/lib/profile.ts");

test("months are added like a bank does: the 31st becomes the last day of a shorter month", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-01-15", 12), "2027-01-15");
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
});

test("a yearly deposit at 6%: the interest after the 19% tax is accrued by days and fixed at maturity", () => {
  const deposit = { principal: 10_000, startDate: "2026-01-01", termMonths: 12, annualRatePercent: 6, capitalization: "maturity", taxed: true };

  // 365 days: 600 gross, 486 net.
  assert.deepEqual(getDepositState(deposit, "2027-01-01"), { maturityDate: "2027-01-01", isMatured: true, interestNet: 486, value: 10_486, interestAtMaturityNet: 486 });
  assert.equal(getDepositState(deposit, "2026-07-02").value, Math.round((10_000 + 486 * 182 / 365) * 100) / 100);
  assert.equal(getDepositState(deposit, "2025-12-01").value, 10_000, "before the start");
  assert.equal(getDepositState(deposit, "2030-01-01").value, 10_486, "stays at the final amount");
});

test("monthly capitalization adds each month's interest to the balance", () => {
  const deposit = { principal: 10_000, startDate: "2026-01-01", termMonths: 3, annualRatePercent: 12, capitalization: "monthly", taxed: false };
  let balance = 10_000;
  for (const days of [31, 28, 31]) balance += balance * 0.12 * days / 365;

  assert.equal(getDepositState(deposit, "2026-04-01").value, Math.round(balance * 100) / 100);
});

test("an equal-installment loan: annuity, balance after the installments due so far, interest split", () => {
  const loan = { principal: 12_000, startDate: "2026-01-10", termMonths: 12, annualRatePercent: 12, installment: "equal" };
  const schedule = buildLoanSchedule(loan);
  const state = getLoanState(loan, "2026-04-10");

  assert.equal(schedule.length, 12);
  assert.equal(schedule[0].date, "2026-02-10");
  assert.equal(schedule[0].payment, 1066.19);
  assert.equal(schedule[0].interest, 120);
  assert.equal(schedule.at(-1).balanceAfter, 0);
  assert.equal(state.paidInstallments, 3);
  assert.equal(state.remainingInstallments, 9);
  assert.equal(state.balance, schedule[2].balanceAfter);
  assert.equal(state.nextInstallment.date, "2026-05-10");
  assert.equal(state.endDate, "2027-01-10");
  assert.ok(Math.abs(state.paidInterest + state.remainingInterest - (1066.19 * 12 - 12_000)) < 0.2);
});

test("a decreasing-installment loan repays the same principal every month", () => {
  const schedule = buildLoanSchedule({ principal: 12_000, startDate: "2026-01-10", termMonths: 12, annualRatePercent: 12, installment: "decreasing" });

  assert.deepEqual(schedule.slice(0, 2).map((item) => [item.principal, item.interest, item.payment]), [[1000, 120, 1120], [1000, 110, 1110]]);
  assert.equal(schedule.at(-1).balanceAfter, 0);
});

test("the wealth value is computed for deposits and scheduled loans, typed in for the rest", () => {
  const base = { id: "w", name: "x", category: "other", value: 500, currency: "PLN", addedAt: "2026-01-01", description: "", annualChangePercent: 0, createdAt: "", updatedAt: "" };

  assert.equal(getWealthItemValue({ ...base, kind: "asset" }, "2026-06-01"), 500);
  assert.equal(getWealthItemValue({ ...base, kind: "asset", category: "deposit", deposit: { principal: 10_000, startDate: "2026-01-01", termMonths: 12, annualRatePercent: 6, capitalization: "maturity", taxed: true } }, "2027-02-01"), 10_486);
  assert.equal(getWealthItemValue({ ...base, kind: "liability", category: "loan", loan: { principal: 12_000, startDate: "2026-01-10", termMonths: 12, annualRatePercent: 0, installment: "equal" } }, "2026-07-10"), 6_000);
});

test("deposit and loan terms survive saving the profile; broken terms are dropped, not guessed", () => {
  const profile = normalizeUserProfile({
    wealthItems: [
      { id: "d", kind: "asset", name: "Lokata", category: "deposit", value: 1, currency: "PLN", addedAt: "2026-01-01", deposit: { principal: 5000, startDate: "2026-02-01", termMonths: 6, annualRatePercent: 5.5, capitalization: "quarterly", taxed: false } },
      { id: "l", kind: "liability", name: "Hipoteka", category: "mortgage", value: 1, currency: "PLN", addedAt: "2026-01-01", loan: { principal: 400000, startDate: "2025-05-15", termMonths: 360, annualRatePercent: 7.1, installment: "decreasing" } },
      { id: "b", kind: "asset", name: "Zła lokata", category: "deposit", value: 1, currency: "PLN", addedAt: "2026-01-01", deposit: { principal: 0, startDate: "nie", termMonths: 0 } },
    ],
  });

  assert.deepEqual(profile.wealthItems[0].deposit, { principal: 5000, startDate: "2026-02-01", termMonths: 6, annualRatePercent: 5.5, capitalization: "quarterly", taxed: false });
  assert.equal(profile.wealthItems[0].category, "deposit");
  assert.equal(profile.wealthItems[1].loan.installment, "decreasing");
  assert.equal(profile.wealthItems[2].deposit, undefined);
});
