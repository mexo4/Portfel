import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compoundSingleDepositValue,
  EDUCATIONAL_ANNUAL_RATES,
  EDUCATIONAL_PRINCIPAL,
  EDUCATIONAL_YEARS,
} from "../src/app/narzedzia/procent-skladany/compound-interest-content.ts";

test("compound-interest illustration uses correct single-deposit effective annual compounding", () => {
  assert.equal(EDUCATIONAL_PRINCIPAL, 1_000);
  assert.deepEqual(EDUCATIONAL_ANNUAL_RATES, [5, 7, 10]);
  assert.deepEqual(EDUCATIONAL_YEARS, [0, 10, 20, 30]);
  assert.deepEqual(
    EDUCATIONAL_ANNUAL_RATES.map((rate) =>
      EDUCATIONAL_YEARS.map((year) => compoundSingleDepositValue(rate, year)),
    ),
    [
      [1_000, 1_629, 2_653, 4_322],
      [1_000, 1_967, 3_870, 7_612],
      [1_000, 2_594, 6_727, 17_449],
    ],
  );
});

test("public calculator page keeps its FAQ schema and adds the educational guide", async () => {
  const page = await readFile(new URL("../src/app/narzedzia/procent-skladany/page.tsx", import.meta.url), "utf8");
  const guide = await readFile(new URL("../src/app/narzedzia/procent-skladany/CompoundInterestGuide.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/app/narzedzia/procent-skladany/page.module.css", import.meta.url), "utf8");

  assert.match(page, /<CompoundInterestCalculator\s*\/>\s*<CompoundInterestGuide\s*\/>/);
  assert.match(page, /"@type": "FAQPage"/);
  assert.match(page, /procent składan/);
  assert.match(guide, /Model kalkulatora/);
  assert.match(guide, /stałej efektywnej stopie rocznej/);
  assert.match(guide, /bez dopłat, kosztów i podatków/);
  assert.match(guide, /Rzeczywista droga nie jest gładką linią/);
  assert.match(styles, /\.scenarioTableWrap\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(styles, /\.driverList\s*\{[^}]*grid-template-columns:\s*1fr/);
});
