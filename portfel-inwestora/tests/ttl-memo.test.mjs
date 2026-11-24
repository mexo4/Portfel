import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTtlMemo } from "../src/lib/server/ttl-memo.ts";

const clock = (start = 1_000) => {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
};

test("an entry is returned until its time to live has passed", () => {
  const time = clock();
  const memo = createTtlMemo({ ttlMs: 1_000, now: time.now });

  memo.set("a", "value");
  assert.equal(memo.get("a"), "value");
  time.advance(999);
  assert.equal(memo.get("a"), "value");
  time.advance(1);
  assert.equal(memo.get("a"), undefined, "expired exactly at the ttl");
  assert.equal(memo.size, 0, "an expired entry is dropped when it is read");
});

test("null is a stored value, undefined is a miss", () => {
  const memo = createTtlMemo({ ttlMs: 1_000 });

  assert.equal(memo.get("missing"), undefined);
  memo.set("known-empty", null);
  assert.equal(memo.get("known-empty"), null);
});

test("setting a key again restarts its time to live", () => {
  const time = clock();
  const memo = createTtlMemo({ ttlMs: 1_000, now: time.now });

  memo.set("a", 1);
  time.advance(900);
  memo.set("a", 2);
  time.advance(900);
  assert.equal(memo.get("a"), 2);
});

test("the size is bounded and the oldest entry goes first", () => {
  const memo = createTtlMemo({ ttlMs: 60_000, maxEntries: 3 });

  for (const key of ["a", "b", "c"]) memo.set(key, key);
  memo.set("a", "a again");
  memo.set("d", "d");

  assert.equal(memo.size, 3);
  assert.equal(memo.get("b"), undefined, "b was the oldest");
  assert.equal(memo.get("a"), "a again");
  assert.equal(memo.get("c"), "c");
  assert.equal(memo.get("d"), "d");
});

test("delete and clear invalidate entries", () => {
  const memo = createTtlMemo({ ttlMs: 60_000 });

  memo.set("a", 1);
  memo.set("b", 2);
  memo.delete("a");
  assert.equal(memo.get("a"), undefined);
  assert.equal(memo.get("b"), 2);
  memo.clear();
  assert.equal(memo.size, 0);
});

// The production cost this memo removes, pinned at the source because the two
// modules need a database and the network:
// - GET /api/fx took 620-780 ms on every call even for the same request, because
//   the EODHD FX pairs fail on the production host and a failure was never
//   remembered, so each call repeated the whole failing sequence before NBP.
// - Every workspace page and portfolio API re-read the shared cache for each
//   issuer without a stored country (about 350 ms per request).

test("EODHD FX pair failures are remembered and a missing key makes no request", () => {
  const source = readFileSync(new URL("../src/lib/server/eodhd.ts", import.meta.url), "utf8");

  assert.match(source, /const fxPairFailures = createTtlMemo<true>\(/);
  assert.match(source, /if \(!hasEodhdApiKey\(\)\) return Promise\.resolve\(null\);/);
  assert.match(source, /if \(fxPairFailures\.get\(pair\)\) return Promise\.resolve\(null\);/);
  assert.match(source, /fxPairFailures\.set\(pair, true\);/);
  assert.match(source, /fxPairFailures\.delete\(pair\);/);
});

test("issuer country lookups are memoised and every invalidation drops the memo", () => {
  const source = readFileSync(new URL("../src/lib/server/issuer-country.ts", import.meta.url), "utf8");
  const invalidate = source.match(/export const invalidateIssuerCountryCacheForIsin = async[\s\S]*?\n\};/);

  assert.match(source, /createTtlMemo<IssuerCountryResolution \| null>\(/);
  assert.ok(invalidate, "the invalidation hook exists");
  assert.match(invalidate[0], /resolutionMemo\.clear\(\);/);
});
