import assert from "node:assert/strict";
import test from "node:test";
import { fetchFxRatesServer } from "../src/lib/server/market-data.ts";

test("XTB historical-only FX uses a dated fixing and never current provider rates", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    assert.match(String(url), /^https:\/\/api\.nbp\.pl\/api\/exchangerates\/tables\/[AB]\/2026-08-03\?format=json$/);
    return Response.json([{ rates: [{ code: "USD", mid: 3.7 }, { code: "EUR", mid: 4.3 }] }]);
  };
  try {
    assert.deepEqual(await fetchFxRatesServer(["USD", "EUR", "UNKNOWN"], "2026-08-03", { historicalOnly: true }), { PLN: 1, USD: 3.7, EUR: 4.3 });
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("unavailable dated FX remains unavailable instead of becoming 1:1 or today's rate", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /^https:\/\/api\.nbp\.pl\//);
    return new Response("Unavailable", { status: 503 });
  };
  try {
    assert.deepEqual(await fetchFxRatesServer(["USD"], "2026-08-03", { historicalOnly: true }), { PLN: 1 });
    assert.equal(calls, 16);
  } finally { globalThis.fetch = originalFetch; }
});
