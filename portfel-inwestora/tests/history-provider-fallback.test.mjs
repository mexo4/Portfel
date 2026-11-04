import assert from "node:assert/strict";
import test from "node:test";
import { fetchPreferredHistoryWithHedge } from "../src/lib/history-provider-fallback.ts";

test("history hedge does not call the fallback when the primary is fast and successful", async () => {
  let fallbackCalls = 0;
  const result = await fetchPreferredHistoryWithHedge(
    async () => [{ source: "primary" }],
    async () => {
      fallbackCalls += 1;
      return [{ source: "fallback" }];
    },
    20,
  );

  assert.deepEqual(result, [{ source: "primary" }]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fallbackCalls, 0);
});

test("history hedge starts the fallback while a slow primary is pending but preserves primary precedence", async () => {
  let fallbackCalls = 0;
  const startedAt = Date.now();
  const result = await fetchPreferredHistoryWithHedge(
    () => new Promise((resolve) => setTimeout(() => resolve([{ source: "primary" }]), 50)),
    async () => {
      fallbackCalls += 1;
      return [{ source: "fallback" }];
    },
    5,
  );

  assert.deepEqual(result, [{ source: "primary" }]);
  assert.equal(fallbackCalls, 1);
  assert.ok(Date.now() - startedAt < 100);
});

test("an empty or failed primary returns fallback history", async () => {
  assert.deepEqual(
    await fetchPreferredHistoryWithHedge(async () => [], async () => [{ source: "fallback" }], 1_000),
    [{ source: "fallback" }],
  );
  assert.deepEqual(
    await fetchPreferredHistoryWithHedge(async () => { throw new Error("provider down"); }, async () => [{ source: "fallback" }], 1_000),
    [{ source: "fallback" }],
  );
});

test("a fallback that completes first is still selected only after the preferred source is empty", async () => {
  const order = [];
  const result = await fetchPreferredHistoryWithHedge(
    () => new Promise((resolve) => setTimeout(() => {
      order.push("primary-empty");
      resolve([]);
    }, 25)),
    async () => {
      order.push("fallback-ready");
      return [{ source: "fallback" }];
    },
    1,
  );

  assert.deepEqual(result, [{ source: "fallback" }]);
  assert.deepEqual(order, ["fallback-ready", "primary-empty"]);
});
