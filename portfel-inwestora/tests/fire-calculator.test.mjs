import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateFire,
  calculateRealAnnualReturnPercent,
  FIRE_MAX_PROJECTION_YEARS,
} from "../src/app/narzedzia/kalkulator-fire/fire-calculator.ts";

test("FIRE calculator derives the 4% target and reaches it in a finite projection", () => {
  const result = calculateFire({
    age: 30,
    portfolio: 100_000,
    monthlyExpenses: 8_000,
    monthlyContribution: 3_000,
    annualReturnPercent: 7,
    inflationPercent: 2.5,
    safeWithdrawalRatePercent: 4,
    useRealValues: true,
  });

  assert.equal(result.target, 2_400_000);
  assert.equal(result.monthlyFireIncome, 8_000);
  assert.ok(result.projection.length > 1);
  assert.ok(result.projection.every((point) => Number.isFinite(point.value) && point.value >= 0));
  assert.ok(result.yearsToFire !== null);
  assert.ok(result.fireAge !== null && result.fireAge > 30);
});

test("real return uses inflation without inflating the target", () => {
  assert.equal(calculateRealAnnualReturnPercent(7, 2.5).toFixed(4), "4.3902");
  const inputs = {
    age: 30,
    portfolio: 0,
    monthlyExpenses: 5_000,
    monthlyContribution: 1_000,
    annualReturnPercent: 7,
    inflationPercent: 8,
    safeWithdrawalRatePercent: 4,
    useRealValues: false,
  };
  const nominal = calculateFire(inputs);
  const real = calculateFire({ ...inputs, useRealValues: true });
  assert.equal(real.target, nominal.target);
  assert.ok(real.realAnnualReturnPercent < 0);
});

test("negative real return does not loop and reports an unreachable target", () => {
  const result = calculateFire({
    age: 40,
    portfolio: 10_000,
    monthlyExpenses: 10_000,
    monthlyContribution: 0,
    annualReturnPercent: 0,
    inflationPercent: 10,
    safeWithdrawalRatePercent: 4,
    useRealValues: true,
  });

  assert.equal(result.isReachable, false);
  assert.equal(result.yearsToFire, null);
  assert.equal(result.fireAge, null);
  assert.equal(result.projection.at(-1)?.year, FIRE_MAX_PROJECTION_YEARS);
  assert.ok(result.projection.every((point) => Number.isFinite(point.value) && point.value >= 0));
});

test("public page exposes the FIRE route, FAQ and related tool links", async () => {
  const page = await readFile(new URL("../src/app/narzedzia/kalkulator-fire/page.tsx", import.meta.url), "utf8");
  const calculator = await readFile(new URL("../src/app/narzedzia/kalkulator-fire/FireCalculator.tsx", import.meta.url), "utf8");
  const sitemap = await readFile(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");

  assert.match(page, /Kalkulator FIRE/);
  assert.match(page, /application\/ld\+json/);
  assert.match(page, /\/narzedzia\/procent-skladany/);
  assert.match(page, /\/kalendarz-gpw/);
  assert.match(calculator, /Liczyć w wartościach realnych/);
  assert.match(calculator, /Bezpieczna stopa wypłaty/);
  assert.match(sitemap, /narzedzia\/kalkulator-fire/);
});
