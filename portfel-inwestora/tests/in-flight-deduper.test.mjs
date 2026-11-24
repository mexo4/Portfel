import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInFlightDeduper } from "../src/lib/server/in-flight.ts";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("concurrent callers with the same key share one computation", async () => {
  const dedupe = createInFlightDeduper();
  const gate = deferred();
  let runs = 0;
  const run = () => {
    runs += 1;
    return gate.promise;
  };

  const first = dedupe("EDO0135", run);
  const second = dedupe("EDO0135", run);
  gate.resolve("series");

  assert.deepEqual(await Promise.all([first, second]), ["series", "series"]);
  assert.equal(runs, 1);
});

test("different keys run independently", async () => {
  const dedupe = createInFlightDeduper();
  let runs = 0;
  const run = async () => ++runs;

  await Promise.all([dedupe("EDO0135", run), dedupe("COI0135", run)]);

  assert.equal(runs, 2);
});

test("a settled computation is not reused, so the next caller starts a fresh one", async () => {
  const dedupe = createInFlightDeduper();
  let runs = 0;
  const run = async () => ++runs;

  assert.equal(await dedupe("EDO0135", run), 1);
  assert.equal(await dedupe("EDO0135", run), 2);
});

test("a failure reaches every waiting caller and is not replayed afterwards", async () => {
  const dedupe = createInFlightDeduper();
  const gate = deferred();
  let runs = 0;
  const run = () => {
    runs += 1;
    return runs === 1 ? gate.promise : Promise.resolve("recovered");
  };

  const first = dedupe("EDO0135", run);
  const second = dedupe("EDO0135", run);
  gate.reject(new Error("upstream down"));

  await assert.rejects(first, /upstream down/);
  await assert.rejects(second, /upstream down/);
  assert.equal(await dedupe("EDO0135", run), "recovered");
  assert.equal(runs, 2);
});

test("bond series resolution goes through the deduper, because the quote and the series are requested together", () => {
  const source = readFileSync(new URL("../src/lib/server/treasury-bonds.ts", import.meta.url), "utf8");

  assert.match(source, /createInFlightDeduper<TreasuryBondSeries>\(\)/);
  assert.match(source, /seriesResolutions\(normalizedCode,/);
});
