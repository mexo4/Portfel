import assert from "node:assert/strict";
import test from "node:test";
import {
  groupEtfListings,
  OpenFigiInstrumentSearchProvider,
  OpenFigiSearchError,
  searchEtfInstruments,
} from "../src/lib/server/openfigi.ts";
import { fetchAssetQuoteServer } from "../src/lib/server/market-data.ts";
import { getPortfolioAssetGroupKey } from "../src/lib/ticker.ts";

const listing = ({
  ticker,
  figi,
  shareClassFIGI = "BBGSHARECLASS1",
  exchCode,
  currency,
  name = "Global Equity ETF",
}) => ({
  ticker,
  name,
  figi,
  compositeFIGI: "BBGCOMPOSITE1",
  shareClassFIGI,
  exchCode,
  currency,
  securityType: "ETF",
});

test("groups only listings that share a stable OpenFIGI identity and ranks an exact ticker first", () => {
  const groups = groupEtfListings("GLOB", [
    listing({
      ticker: "GLOA",
      figi: "BBG000000001",
      exchCode: "LN",
      currency: "GBP",
    }),
    listing({
      ticker: "GLOB",
      figi: "BBG000000002",
      exchCode: "GY",
      currency: "EUR",
    }),
    listing({
      ticker: "GLOB",
      figi: "BBG000000002",
      exchCode: "GY",
      currency: "EUR",
    }),
    listing({
      ticker: "OTHER",
      figi: "BBG000000003",
      shareClassFIGI: "BBGSHARECLASS2",
      exchCode: "US",
      currency: "USD",
      name: "Other ETF",
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "Global Equity ETF");
  assert.equal(groups[0].listings.length, 2);
  assert.equal(groups[0].listings[0].symbol, "GLOB");
  assert.equal(groups[0].listings[0].instrumentIdentity.figi, "BBG000000002");
  assert.equal(groups[0].listings[1].marketCurrency, "GBP");
});

test("keeps an OpenFIGI listing when the v3 response has no currency and marks it for confirmation", () => {
  const [group] = groupEtfListings("NOCUR", [
    {
      ticker: "NOCUR",
      name: "Currency not returned ETF",
      figi: "BBG000000009",
      exchCode: "US",
      securityType: "ETF",
    },
  ]);

  assert.equal(group.listings[0].instrumentIdentity.currency, undefined);
  assert.equal(group.listings[0].marketCurrency, "USD");
});

test("uses OpenFIGI v3 filter with the API key only in a server-side header", async () => {
  let requestedUrl = "";
  let requestInit;
  const provider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async (url, init) => {
      requestedUrl = String(url);
      requestInit = init;
      return new Response(
        JSON.stringify({
          data: [
            listing({
              ticker: "ALPH",
              figi: "BBG000000010",
              exchCode: "US",
              currency: "USD",
              name: "Alpha ETF",
            }),
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  );

  const groups = await provider.searchEtfs(" alpha ");

  assert.equal(requestedUrl, "https://api.openfigi.com/v3/filter");
  assert.equal(requestInit.headers["X-OPENFIGI-APIKEY"], "server-only-key");
  assert.deepEqual(JSON.parse(requestInit.body), { query: "alpha", securityType: "ETF" });
  assert.equal(groups[0].listings[0].symbol, "ALPH");
});

test("uses the v3 mapping endpoint for FIGI and reports configuration or provider limits safely", async () => {
  const mappingProvider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async (url, init) => {
      assert.equal(String(url), "https://api.openfigi.com/v3/mapping");
      assert.deepEqual(JSON.parse(init.body), [
        { idType: "ID_BB_GLOBAL", idValue: "BBG000000099" },
      ]);
      return new Response(
        JSON.stringify([{ data: [listing({
          ticker: "FIGI",
          figi: "BBG000000099",
          exchCode: "US",
          currency: "USD",
        })] }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  );

  const groups = await mappingProvider.searchEtfs("BBG000000099");
  assert.equal(groups[0].listings[0].instrumentIdentity.figi, "BBG000000099");

  await assert.rejects(
    () => new OpenFigiInstrumentSearchProvider("").searchEtfs("ALPHA"),
    (error) => error instanceof OpenFigiSearchError && error.code === "configuration"
  );

  await assert.rejects(
    () =>
      new OpenFigiInstrumentSearchProvider(
        "server-only-key",
        async () => new Response("{}", { status: 429 })
      ).searchEtfs("ALPHA"),
    (error) => error instanceof OpenFigiSearchError && error.code === "rate_limit"
  );
});

test("caches a normalized ETF search without caching a price", async () => {
  let calls = 0;
  const provider = {
    searchEtfs: async () => {
      calls += 1;
      return groupEtfListings("CACHEETF", [
        listing({
          ticker: "CACHEETF",
          figi: "BBG000000111",
          exchCode: "US",
          currency: "USD",
        }),
      ]);
    },
  };

  const first = await searchEtfInstruments("cache-etf-test-unique", provider);
  const second = await searchEtfInstruments("cache-etf-test-unique", provider);

  assert.equal(calls, 1);
  assert.equal(first[0].listings[0].priceStatus, "unchecked");
  assert.deepEqual(second, first);
});

test("keeps ETF listings separate and never guesses a quote without a resolved price symbol", async () => {
  const left = {
    kind: "etf",
    symbol: "SAME",
    instrumentIdentity: {
      ticker: "SAME",
      name: "Same fund, first listing",
      instrumentType: "ETF",
      figi: "BBG000000201",
      currency: "EUR",
    },
  };
  const right = {
    ...left,
    instrumentIdentity: {
      ...left.instrumentIdentity,
      figi: "BBG000000202",
    },
  };

  assert.notEqual(getPortfolioAssetGroupKey(left), getPortfolioAssetGroupKey(right));
  assert.equal(
    await fetchAssetQuoteServer({
      symbol: "SAME",
      kind: "etf",
      marketCurrency: "EUR",
      provider: "eodhd",
    }),
    null
  );
});
