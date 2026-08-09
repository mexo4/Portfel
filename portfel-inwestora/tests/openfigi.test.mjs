import assert from "node:assert/strict";
import test from "node:test";
import {
  groupEtfListings,
  groupEtfInstrumentResults,
  OpenFigiInstrumentSearchProvider,
  OpenFigiSearchError,
  searchInstruments,
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

test("uses an unfiltered OpenFIGI v3 search with the API key only in a server-side header", async () => {
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

  const results = await provider.search(" alpha ");

  assert.equal(requestedUrl, "https://api.openfigi.com/v3/filter");
  assert.equal(requestInit.headers["X-OPENFIGI-APIKEY"], "server-only-key");
  assert.deepEqual(JSON.parse(requestInit.body), { query: "alpha" });
  assert.equal(results[0].symbol, "ALPH");
  assert.equal(results[0].isEtf, true);
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

  const results = await mappingProvider.search("BBG000000099");
  assert.equal(results[0].figi, "BBG000000099");

  await assert.rejects(
    () => new OpenFigiInstrumentSearchProvider("").search("ALPHA"),
    (error) => error instanceof OpenFigiSearchError && error.code === "configuration"
  );

  await assert.rejects(
    () =>
      new OpenFigiInstrumentSearchProvider(
        "server-only-key",
        async () => new Response("{}", { status: 429 })
      ).search("ALPHA"),
    (error) => error instanceof OpenFigiSearchError && error.code === "rate_limit"
  );
});

test("caches generic discovery separately from prices", async () => {
  let calls = 0;
  const provider = {
    search: async () => {
      calls += 1;
      return [
        {
          id: "BBG000000111",
          symbol: "CACHEETF",
          name: "Cache ETF",
          instrumentType: "ETF",
          isEtf: true,
          figi: "BBG000000111",
          exchangeCode: "US",
          currency: "USD",
          securityType: "ETF",
        },
      ];
    },
  };

  const first = await searchInstruments("cache-etf-test-unique", provider);
  const second = await searchInstruments("cache-etf-test-unique", provider);

  assert.equal(calls, 1);
  assert.equal(first.etfGroups[0].listings[0].priceStatus, "unchecked");
  assert.deepEqual(second, first);
});

test("retains an index in generic OpenFIGI results while grouping only ETF listings", async () => {
  const requestedQueries = [];
  const provider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async (_url, init) => {
      const { query } = JSON.parse(init.body);
      requestedQueries.push(query);

      if (query === "S&P500") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          data: [
            {
              ticker: "SPX",
              name: "S&P 500 Index",
              figi: "BBG000BDTBL9",
              securityType: "Index",
              securityType2: "Equity Index",
              marketSector: "Index",
            },
            listing({
              ticker: "SPY",
              figi: "BBG000BDTBL8",
              exchCode: "US",
              currency: "USD",
              name: "SPDR S&P 500 ETF Trust",
            }),
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  );

  const results = await provider.search("S&P500");
  const groups = groupEtfInstrumentResults("S&P500", results);

  assert.deepEqual(requestedQueries, ["S&P500", "S&P 500"]);
  assert.equal(results.find((result) => result.symbol === "SPX")?.instrumentType, "Index");
  assert.equal(results.find((result) => result.symbol === "SPX")?.isEtf, false);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].listings[0].symbol, "SPY");
});

test("normalizes punctuation, spaces, and letter-number boundaries without instrument aliases", async () => {
  const indexResult = {
    ticker: "SPX",
    name: "S&P 500 Index",
    figi: "BBG000BDTBL9",
    securityType: "Index",
  };
  const variants = {
    "S&P 500": ["S&P 500"],
    "S&P500": ["S&P500", "S&P 500"],
    sp500: ["sp500", "sp 500"],
  };

  for (const [query, expectedRequests] of Object.entries(variants)) {
    const requestedQueries = [];
    const provider = new OpenFigiInstrumentSearchProvider(
      "server-only-key",
      async (_url, init) => {
        const { query: sentQuery } = JSON.parse(init.body);
        requestedQueries.push(sentQuery);
        return new Response(
          JSON.stringify({ data: sentQuery === expectedRequests.at(-1) ? [indexResult] : [] }),
          { status: 200 }
        );
      }
    );

    const results = await provider.search(query);
    assert.deepEqual(requestedQueries, expectedRequests);
    assert.equal(results[0].symbol, "SPX");
    assert.equal(results[0].isEtf, false);
  }
});

test("keeps direct ticker results for ETF and non-ETF queries without a security type filter", async () => {
  const symbolsByQuery = {
    SPY: [listing({ ticker: "SPY", figi: "BBG000BDTBL8", exchCode: "US", currency: "USD" })],
    QQQ: [listing({ ticker: "QQQ", figi: "BBG000BDTBL7", exchCode: "US", currency: "USD" })],
    VWCE: [listing({ ticker: "VWCE", figi: "BBG000BDTBL6", exchCode: "GY", currency: "EUR" })],
    SXR8: [listing({ ticker: "SXR8", figi: "BBG000BDTBL5", exchCode: "GY", currency: "EUR" })],
  };
  const payloads = [];
  const provider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async (_url, init) => {
      const payload = JSON.parse(init.body);
      payloads.push(payload);
      return new Response(JSON.stringify({ data: symbolsByQuery[payload.query] ?? [] }), {
        status: 200,
      });
    }
  );

  for (const query of Object.keys(symbolsByQuery)) {
    const results = await provider.search(query);
    assert.equal(results[0].symbol, query);
    assert.equal(results[0].isEtf, true);
  }

  assert.equal(payloads.every((payload) => !Object.hasOwn(payload, "securityType")), true);
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
