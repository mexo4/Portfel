import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// These tests must never reach a real database or API.
for (const name of ["DATABASE_URL", "POSTGRES_CA_CERT_PATH", "POSTGRES_CA_CERT_BASE64", "EODHD_API_KEY"]) {
  delete process.env[name];
}

const { fetchAssetQuoteServer } = await import("../src/lib/server/market-data.ts");
const { stooqCooldown } = await import("../src/lib/server/provider-cooldown.ts");

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const isStooq = (url) => url.hostname === "stooq.pl" || url.hostname === "stooq.com";

const yahooChart = (symbol, price) => {
  const time = Math.floor(Date.now() / 1_000);

  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            currency: "USD",
            regularMarketPrice: price,
            chartPreviousClose: price - 1,
            regularMarketTime: time,
            instrumentType: "EQUITY",
            longName: `${symbol} Inc.`,
          },
          timestamp: [time - 86_400, time],
          indicators: { quote: [{ close: [price - 1, price] }] },
        },
      ],
      error: null,
    },
  };
};

/**
 * `stooq` decides what Stooq does (no response at all is what the production
 * server sees). Yahoo answers for any symbol, so a quote that Stooq cannot give
 * still has a next source; nothing else is reachable.
 */
const installFetch = ({ stooq }) => {
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);

    if (isStooq(url)) return stooq(url);

    if (url.hostname.endsWith("finance.yahoo.com")) {
      if (url.pathname.startsWith("/v7/")) return json({}, 401);

      return json(yahooChart(decodeURIComponent(url.pathname.split("/").pop()), 55.5));
    }

    return new Response("not found", { status: 404 });
  };

  return calls;
};

const stooqRequest = (symbol) => ({
  symbol,
  kind: "stock",
  marketCurrency: "USD",
  provider: "stooq",
});

const noResponse = () => {
  throw new TypeError("fetch failed");
};

test("a quote stops asking Stooq once it has not answered twice, and still gets its price", async () => {
  stooqCooldown.reset();
  const calls = installFetch({ stooq: noResponse });

  const first = await fetchAssetQuoteServer(stooqRequest("ZZA"));
  const stooqCallsForFirst = calls.filter(isStooq).length;

  assert.equal(first?.price, 55.5, "the price comes from the next source");
  assert.ok(stooqCallsForFirst >= 2, "it did try Stooq until the cooldown opened");
  assert.ok(stooqCallsForFirst < 6, "and then stopped part-way through its own calls");
  assert.equal(stooqCooldown.isCoolingDown(), true);

  // The next positions never reach Stooq at all.
  const second = await fetchAssetQuoteServer(stooqRequest("ZZB"));
  const third = await fetchAssetQuoteServer(stooqRequest("ZZC"));

  assert.equal(second?.price, 55.5);
  assert.equal(third?.price, 55.5);
  assert.equal(calls.filter(isStooq).length, stooqCallsForFirst, "no Stooq request while it cools down");

  stooqCooldown.reset();
});

test("a Stooq that answers is used as before, and a refusal or an empty answer is not 'no answer'", async () => {
  stooqCooldown.reset();
  const csv = "Symbol,Data,Czas,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen\nZZD.US,2026-11-23,17:05:00,10,11,9,10.5,1000\n";
  const calls = installFetch({
    stooq: (url) =>
      url.pathname.startsWith("/q/l/") && url.searchParams.get("e") === "csv"
        ? new Response(csv, { status: 200 })
        : new Response("Brak danych", { status: 404 }),
  });

  const quote = await fetchAssetQuoteServer(stooqRequest("ZZD"));
  await fetchAssetQuoteServer(stooqRequest("ZZE"));

  assert.equal(quote?.price, 10.5);
  assert.equal(quote?.provider, "stooq");
  assert.ok(calls.filter(isStooq).length > 0, "Stooq was asked");
  assert.equal(stooqCooldown.isCoolingDown(), false, "answers, even refusals, never open the cooldown");

  stooqCooldown.reset();
});

test("a single failed Stooq request does not switch it off", async () => {
  stooqCooldown.reset();
  let stooqRequests = 0;

  installFetch({
    stooq: () => {
      stooqRequests += 1;
      return stooqRequests === 1 ? noResponse() : new Response("Brak danych", { status: 404 });
    },
  });

  await fetchAssetQuoteServer(stooqRequest("ZZF"));

  assert.equal(stooqCooldown.isCoolingDown(), false);
  assert.ok(stooqRequests > 1, "later requests still went to Stooq");

  stooqCooldown.reset();
});

test("every Stooq request in the quote code, GPW included, goes through the cooldown", async () => {
  const source = (await readFile(new URL("../src/lib/server/market-data.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

  assert.match(source, /const safeFetchStooq = async \(url: string, init\?: RequestInit, timeoutMs\?: number\) => \{\n  if \(stooqCooldown\.isCoolingDown\(\)\) return null;/);
  assert.match(source, /if \(!response\) stooqCooldown\.markUnavailable\(\);/);

  // No Stooq host is fetched by the plain helper, which would bypass the cooldown.
  assert.deepEqual(source.match(/await safeFetch\(\n?\s*[`"'][^`"']*stooq/g) ?? [], []);
  assert.deepEqual(source.match(/await safeFetch\(\n?\s*`\$\{domain\}/g) ?? [], []);
  // The GPW live CSV, the GPW history CSV, and the three calls of the generic path.
  assert.equal(source.split("await safeFetchStooq(").length - 1, 5);
});
