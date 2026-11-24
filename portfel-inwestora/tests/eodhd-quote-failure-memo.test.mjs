import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These tests must never reach a real database or API. The module below reads its
// environment when it loads, so it is prepared before the import.
for (const name of ["DATABASE_URL", "POSTGRES_CA_CERT_PATH", "POSTGRES_CA_CERT_BASE64"]) {
  delete process.env[name];
}
process.env.EODHD_API_KEY = "test-eodhd-key";

const { fetchEodhdQuote } = await import("../src/lib/server/eodhd.ts");

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

// A Warsaw listing that EODHD does not price used to cost two requests (real-time, then
// end-of-day) on every refresh before Yahoo finally answered. The answer is now remembered.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Routes every request through `handler` and records it. */
const installFetch = (handler) => {
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return handler(url);
  };

  return calls;
};

/** `real-time` or `eod`, in the order the requests were made. */
const endpoints = (calls) => calls.map((url) => url.pathname.split("/")[2]);

const ask = (providerId) =>
  fetchEodhdQuote({ symbol: "XYZ", providerId, marketCurrency: "PLN" });

test("a listing EODHD does not know is asked about once, not on every refresh", async () => {
  const calls = installFetch(() => new Response("missing", { status: 404 }));

  assert.equal(await ask("UNKNOWN1.PL"), null);
  assert.deepEqual(endpoints(calls), ["real-time", "eod"]);

  // The caller moves straight on to its next source.
  assert.equal(await ask("UNKNOWN1.PL"), null);
  assert.equal(await ask("unknown1.pl"), null);
  assert.equal(calls.length, 2, "no further request for the same listing");

  // The memory is per listing: another one is still asked.
  assert.equal(await ask("UNKNOWN2.PL"), null);
  assert.deepEqual(endpoints(calls), ["real-time", "eod", "real-time", "eod"]);
});

test("an answer without a price counts as unknown, not only an error status", async () => {
  const calls = installFetch((url) =>
    url.pathname.includes("/real-time/") ? json({ close: "NA" }) : json([])
  );

  assert.equal(await ask("EMPTY1.PL"), null);
  assert.equal(await ask("EMPTY1.PL"), null);
  assert.deepEqual(endpoints(calls), ["real-time", "eod"]);
});

test("a reached limit costs one request, skips the end-of-day call and is not repeated at once", async () => {
  const calls = installFetch(() => new Response("quota", { status: 402 }));

  assert.equal(await ask("LIMITED1.PL"), null);
  assert.deepEqual(endpoints(calls), ["real-time"]);

  assert.equal(await ask("LIMITED1.PL"), null);
  assert.equal(calls.length, 1, "the quota is not spent again straight away");
});

test("a network failure is not repeated at once either", async () => {
  const calls = installFetch(() => {
    throw new Error("offline");
  });

  assert.equal(await ask("OFFLINE1.PL"), null);
  assert.deepEqual(endpoints(calls), ["real-time", "eod"]);

  assert.equal(await ask("OFFLINE1.PL"), null);
  assert.equal(calls.length, 2);
});

test("a listing with a price is served as before, from real-time or from the end-of-day history", async () => {
  const realtime = installFetch(() =>
    json({ close: 12.5, previousClose: 12, timestamp: Math.floor(Date.now() / 1_000) })
  );
  const live = await ask("PRICED1.PL");

  assert.equal(live?.price, 12.5);
  assert.equal(live?.provider, "eodhd");
  assert.deepEqual(endpoints(realtime), ["real-time"]);

  const history = installFetch((url) =>
    url.pathname.includes("/real-time/")
      ? new Response("missing", { status: 404 })
      : json([
          { date: "2026-11-20", close: 10 },
          { date: "2026-11-21", close: 11 },
        ])
  );
  const closed = await ask("PRICED2.PL");

  assert.equal(closed?.price, 11);
  assert.equal(closed?.previousClose, 10);
  assert.deepEqual(endpoints(history), ["real-time", "eod"]);
});

test("the memory lasts minutes for an unknown listing and only a minute for a limit or an outage", () => {
  const source = readFileSync(new URL("../src/lib/server/eodhd.ts", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  );

  assert.match(source, /const EODHD_QUOTE_NO_DATA_TTL_MS = 5 \* 60 \* 1_000;/);
  assert.match(source, /const EODHD_QUOTE_TROUBLE_TTL_MS = 60 \* 1_000;/);
  assert.match(source, /if \(quoteNoData\.get\(normalizedProviderId\) \|\| quoteTrouble\.get\(normalizedProviderId\)\) \{\n    return null;/);
});
