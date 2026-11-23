import assert from "node:assert/strict";
import test from "node:test";

// These tests must never reach a real database or API. The modules below read
// their environment when they load, so it is prepared before the imports.
for (const name of ["DATABASE_URL", "POSTGRES_CA_CERT_PATH", "POSTGRES_CA_CERT_BASE64"]) {
  delete process.env[name];
}
process.env.EODHD_API_KEY = "test-eodhd-key";

const { fetchAssetQuoteServer, isFreshCryptoQuote } = await import(
  "../src/lib/server/market-data.ts"
);
const { buildBenchmarkComparisons } = await import("../src/lib/server/benchmarks.ts");
const {
  groupEtfListings,
  OpenFigiSearchError,
  resolveEtfListingPriceSource,
  sanitiseEtfListing,
  searchEtfInstruments,
} = await import("../src/lib/server/openfigi.ts");
const {
  fetchYahooCryptoHistoryPoints,
  isConfirmedYahooCrypto,
  searchYahooEtfListings,
  toYahooCryptoSymbol,
  toYahooSymbolFromEodhdProviderId,
  toYahooSymbolFromOpenFigiListing,
} = await import("../src/lib/server/yahoo-backup.ts");
const { fetchYahooDailyHistory } = await import("../src/lib/server/yahoo.ts");
const { describeEndpoint } = await import("../src/lib/server/provider-diagnostics.ts");

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Routes every request through `handler`; an unanswered request fails loudly. */
const installFetch = (handler) => {
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const response = await handler(url);

    if (!response) {
      throw new Error(`unexpected request: ${url.href}`);
    }

    return response;
  };

  return calls;
};

const isYahoo = (url) => url.hostname.endsWith("finance.yahoo.com");
const yahooCalls = (calls) => calls.filter(isYahoo);
const yahooChartSymbols = (calls) =>
  yahooCalls(calls)
    .filter((url) => url.pathname.startsWith("/v8/finance/chart/"))
    .map((url) => decodeURIComponent(url.pathname.split("/").pop()));

const nowSeconds = () => Math.floor(Date.now() / 1_000);

const yahooChart = ({
  symbol,
  currency,
  price,
  instrumentType = "ETF",
  name,
  time = nowSeconds(),
}) => ({
  chart: {
    result: [
      {
        meta: {
          symbol,
          currency,
          regularMarketPrice: price,
          chartPreviousClose: price - 1,
          regularMarketTime: time,
          instrumentType,
          longName: name,
        },
        timestamp: [time - 86_400, time],
        indicators: { quote: [{ close: [price - 1, price] }] },
      },
    ],
    error: null,
  },
});

/** Yahoo's quote endpoint wants a crumb; the chart endpoint answers without one. */
const yahooHandler = (chartBySymbol) => (url) => {
  if (!isYahoo(url)) return null;
  if (url.pathname.startsWith("/v7/")) return json({}, 401);

  const symbol = decodeURIComponent(url.pathname.split("/").pop());
  const chart = chartBySymbol[symbol];
  return chart ? json(chart) : json({ chart: { result: null } }, 404);
};

const etfRequest = (overrides = {}) => ({
  symbol: "CSPX",
  kind: "etf",
  marketCurrency: "USD",
  provider: "eodhd",
  providerId: "CSPX.LSE",
  ...overrides,
});

test("an EODHD provider id maps to a Yahoo symbol only for a known venue", () => {
  const expected = {
    "CSPX.LSE": "CSPX.L",
    "cspx.lse": "CSPX.L",
    "VWCE.XETRA": "VWCE.DE",
    "SPY.US": "SPY",
    "SXRV.F": "SXRV.F",
    "IWDA.AS": "IWDA.AS",
    "ETFBW20TR.PL": "ETFBW20TR.WA",
    "ETFBW20TR.WAR": "ETFBW20TR.WA",
    "2800.HK": "2800.HK",
    "XYZ.NEO": null,
    "XYZ.STU": null,
    CSPX: null,
    ".LSE": null,
    "CSPX.": null,
    "TOO-LONG-NAME-FOR-A-TICKER.LSE": null,
  };

  for (const [providerId, yahooSymbol] of Object.entries(expected)) {
    assert.equal(toYahooSymbolFromEodhdProviderId(providerId), yahooSymbol, providerId);
  }
});

test("a crypto symbol maps to its USD pair and nothing else does", () => {
  assert.equal(toYahooCryptoSymbol("link"), "LINK-USD");
  assert.equal(toYahooCryptoSymbol("BTC"), "BTC-USD");
  assert.equal(toYahooCryptoSymbol("BTC-USD"), null);
  assert.equal(toYahooCryptoSymbol("A"), null);
  assert.equal(toYahooCryptoSymbol("ETH/USD"), null);
});

test("an OpenFIGI venue maps to Yahoo only for a listing that came from OpenFIGI", () => {
  const openFigi = (exchangeCode, figi) => ({
    symbol: "VWRP",
    exchangeCode,
    instrumentIdentity: { ticker: "VWRP", name: "Vanguard", instrumentType: "ETF", figi, exchangeCode },
  });
  const fromOpenFigi = (exchangeCode) => openFigi(exchangeCode, "BBG000000001");

  assert.equal(toYahooSymbolFromOpenFigiListing(fromOpenFigi("LN")), "VWRP.L");
  assert.equal(toYahooSymbolFromOpenFigiListing(fromOpenFigi("GR")), "VWRP.DE");
  assert.equal(toYahooSymbolFromOpenFigiListing(fromOpenFigi("US")), "VWRP");
  assert.equal(toYahooSymbolFromOpenFigiListing(fromOpenFigi("CT")), "VWRP.TO");
  assert.equal(toYahooSymbolFromOpenFigiListing(fromOpenFigi("TR")), null);
  // No FIGI means the venue code is not a Bloomberg code, so it is not mapped.
  assert.equal(toYahooSymbolFromOpenFigiListing(openFigi("LN", undefined)), null);
});

test("diagnostics never print the query string, so an API token cannot leak", () => {
  assert.equal(
    describeEndpoint("https://eodhd.com/api/real-time/CSPX.LSE?api_token=SECRET&fmt=json"),
    "eodhd.com/api/real-time/CSPX.LSE"
  );
  assert.equal(describeEndpoint("not a url"), "unknown-endpoint");
});

test("an ETF whose EODHD quote hits the daily limit is priced by Yahoo without changing its identity", async () => {
  const calls = installFetch((url) => {
    if (url.hostname === "eodhd.com") return new Response("quota", { status: 402 });
    return yahooHandler({
      "CSPX.L": yahooChart({ symbol: "CSPX.L", currency: "USD", price: 612.34 }),
    })(url);
  });

  const quote = await fetchAssetQuoteServer(etfRequest());

  assert.equal(quote?.price, 612.34);
  assert.equal(quote?.backupSource, "yahoo");
  // The saved asset must keep its own mapping: the client copies these fields.
  assert.equal(quote?.provider, "eodhd");
  assert.equal(quote?.providerId, "CSPX.LSE");
  assert.equal(quote?.marketCurrency, "USD");
  assert.equal(quote?.symbol, "CSPX");
  assert.equal(quote?.name, undefined);
  assert.equal(quote?.instrumentType, undefined);
  assert.equal(typeof quote?.marketTimestamp, "string");
  // Yahoo is asked for this listing only, never for the bare ticker.
  assert.deepEqual(yahooChartSymbols(calls), ["CSPX.L"]);
  assert.ok(yahooCalls(calls).every((url) => url.searchParams.get("symbols") !== "CSPX"));
  // The daily limit would refuse the end-of-day call too, so it is not spent.
  assert.equal(calls.filter((url) => url.pathname.startsWith("/api/eod/")).length, 0);
});

test("an ETF quote from Yahoo in another currency is refused", async () => {
  installFetch((url) => {
    if (url.hostname === "eodhd.com") return new Response("quota", { status: 402 });
    return yahooHandler({
      "IWDA.L": yahooChart({ symbol: "IWDA.L", currency: "USD", price: 98.1 }),
    })(url);
  });

  const quote = await fetchAssetQuoteServer(
    etfRequest({ symbol: "IWDA", providerId: "IWDA.LSE", marketCurrency: "GBP" })
  );

  assert.equal(quote, null);
});

test("an ETF on a venue without a safe Yahoo spelling is not sent to Yahoo", async () => {
  const calls = installFetch((url) =>
    url.hostname === "eodhd.com" ? new Response("quota", { status: 402 }) : null
  );

  const quote = await fetchAssetQuoteServer(
    etfRequest({ symbol: "NEOETF", providerId: "NEOETF.NEO", marketCurrency: "CAD" })
  );

  assert.equal(quote, null);
  assert.equal(yahooCalls(calls).length, 0);
});

test("an ETF without a provider id still gets no automatic quote and no request", async () => {
  const calls = installFetch(() => null);

  const quote = await fetchAssetQuoteServer(etfRequest({ symbol: "BAREETF", providerId: undefined }));

  assert.equal(quote, null);
  assert.equal(calls.length, 0);
});

test("an ETF that EODHD can price never reaches Yahoo", async () => {
  const calls = installFetch((url) => {
    if (url.hostname === "eodhd.com") {
      return url.pathname.endsWith("/SPY5.LSE")
        ? json({ close: 123.45, previousClose: 120, timestamp: nowSeconds() })
        : new Response("missing", { status: 404 });
    }
    return null;
  });

  const quote = await fetchAssetQuoteServer(
    etfRequest({ symbol: "SPY5", providerId: "SPY5.LSE" })
  );

  assert.equal(quote?.price, 123.45);
  assert.equal(quote?.provider, "eodhd");
  assert.equal(quote?.backupSource, undefined);
  assert.equal(yahooCalls(calls).length, 0);
});

const cryptoRequest = (overrides = {}) => ({
  symbol: "LINK",
  kind: "crypto",
  marketCurrency: "USD",
  provider: "coingecko",
  providerId: "chainlink",
  ...overrides,
});

const cryptoHandler = (chartBySymbol) => (url) => {
  if (url.hostname === "api.coingecko.com" || url.hostname === "api.binance.com") {
    return new Response("limit", { status: 429 });
  }
  return yahooHandler(chartBySymbol)(url);
};

test("a coin whose CoinGecko quote is rate limited is priced by Yahoo and keeps its CoinGecko id", async () => {
  const calls = installFetch(
    cryptoHandler({
      "LINK-USD": yahooChart({
        symbol: "LINK-USD",
        currency: "USD",
        price: 18.75,
        instrumentType: "CRYPTOCURRENCY",
        name: "Chainlink USD",
      }),
    })
  );

  const quote = await fetchAssetQuoteServer(cryptoRequest());

  assert.equal(quote?.price, 18.75);
  assert.equal(quote?.backupSource, "yahoo");
  assert.equal(quote?.provider, "coingecko");
  assert.equal(quote?.providerId, "chainlink");
  assert.equal(quote?.marketCurrency, "USD");
  assert.deepEqual(yahooChartSymbols(calls), ["LINK-USD"]);
});

test("a crypto quote from Yahoo is refused when it is stale or not a crypto pair", async () => {
  installFetch(
    cryptoHandler({
      "AAVE-USD": yahooChart({
        symbol: "AAVE-USD",
        currency: "USD",
        price: 7.1,
        instrumentType: "CRYPTOCURRENCY",
        name: "Aave USD",
        time: nowSeconds() - 600,
      }),
      "MKR-USD": yahooChart({
        symbol: "MKR-USD",
        currency: "USD",
        price: 1800,
        instrumentType: "EQUITY",
        name: "Maker USD",
      }),
    })
  );

  assert.equal(
    await fetchAssetQuoteServer(cryptoRequest({ symbol: "AAVE", providerId: "aave" })),
    null
  );
  assert.equal(
    await fetchAssetQuoteServer(cryptoRequest({ symbol: "MKR", providerId: "maker" })),
    null
  );
});

test("a crypto ticker that Yahoo gives to another coin is never priced from it", async () => {
  // Yahoo's ARB-USD is "ARbit", not Arbitrum: same ticker, a different coin.
  installFetch(
    cryptoHandler({
      "ARB-USD": yahooChart({
        symbol: "ARB-USD",
        currency: "USD",
        price: 0.0004,
        instrumentType: "CRYPTOCURRENCY",
        name: "ARbit USD",
      }),
      "XYZ-USD": yahooChart({
        symbol: "XYZ-USD",
        currency: "USD",
        price: 5,
        instrumentType: "CRYPTOCURRENCY",
        name: "Xyz Coin USD",
      }),
    })
  );

  assert.equal(
    await fetchAssetQuoteServer(cryptoRequest({ symbol: "ARB", providerId: "arbitrum" })),
    null
  );
  // No known name for the ticker and no CoinGecko id to compare with.
  assert.equal(
    await fetchAssetQuoteServer(cryptoRequest({ symbol: "XYZ", providerId: undefined })),
    null
  );
});

test("a major coin is confirmed by its known name even when its CoinGecko id differs", async () => {
  installFetch(
    cryptoHandler({
      "XRP-USD": yahooChart({
        symbol: "XRP-USD",
        currency: "USD",
        price: 2.31,
        instrumentType: "CRYPTOCURRENCY",
        name: "XRP USD",
      }),
    })
  );

  const quote = await fetchAssetQuoteServer(
    cryptoRequest({ symbol: "XRP", providerId: "ripple" })
  );

  assert.equal(quote?.price, 2.31);
  assert.equal(quote?.providerId, "ripple");
  assert.equal(quote?.backupSource, "yahoo");
});

test("a crypto asset quoted in another currency is not sent to Yahoo", async () => {
  const calls = installFetch(cryptoHandler({}));

  const quote = await fetchAssetQuoteServer(
    cryptoRequest({ symbol: "DOTX", providerId: "polkadotx", marketCurrency: "PLN" })
  );

  assert.equal(quote, null);
  assert.equal(yahooCalls(calls).length, 0);
});

test("a crypto quote that Binance can serve never reaches Yahoo", async () => {
  const calls = installFetch((url) =>
    url.hostname === "api.binance.com"
      ? json({ lastPrice: "3100.50", prevClosePrice: "3000.00", closeTime: Date.now() - 1_000 })
      : null
  );

  const quote = await fetchAssetQuoteServer(
    cryptoRequest({ symbol: "ETH", providerId: "ethereum" })
  );

  assert.equal(quote?.provider, "binance");
  assert.equal(quote?.backupSource, undefined);
  assert.equal(yahooCalls(calls).length, 0);
});

test("a coin name is confirmed against the known name or the saved CoinGecko id, never the ticker alone", () => {
  const confirmed = (symbol, providerId, yahooName) =>
    isConfirmedYahooCrypto({ symbol, providerId, yahooName });

  assert.equal(confirmed("LINK", "chainlink", "Chainlink USD"), true);
  assert.equal(confirmed("link", undefined, "Chainlink USD"), true);
  assert.equal(confirmed("XRP", "ripple", "XRP USD"), true);
  assert.equal(confirmed("AAVE", "aave", "Aave USD"), true);
  assert.equal(confirmed("BCH", "bitcoin-cash", "Bitcoin Cash USD"), true);
  assert.equal(confirmed("ARB", "arbitrum", "ARbit USD"), false);
  assert.equal(confirmed("ARB", undefined, "ARbit USD"), false);
  assert.equal(confirmed("BTC", "bitcoin", "Bitcoin Cash USD"), false);
  assert.equal(confirmed("AAVE", "aave", undefined), false);
});

test("the crypto age limit is 20 s by default and can be widened for the backup", () => {
  const quote = { marketTimestamp: new Date(Date.now() - 30_000).toISOString() };

  assert.equal(isFreshCryptoQuote(quote), false);
  assert.equal(isFreshCryptoQuote(quote, Date.now(), 60_000), true);
});

test("Yahoo daily history keeps raw closes, sorts them and reports the instrument", async () => {
  installFetch((url) => {
    if (!isYahoo(url)) return null;
    const day = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1_000);

    return json({
      chart: {
        result: [
          {
            meta: {
              currency: "USD",
              instrumentType: "CRYPTOCURRENCY",
              symbol: "HIST-USD",
              longName: "Hist Coin USD",
            },
            timestamp: [day("2024-01-03"), day("2024-01-01"), day("2024-01-02"), day("2024-01-04")],
            indicators: {
              quote: [{ close: [30, 10, 20, null] }],
              adjclose: [{ adjclose: [1, 1, 1, 1] }],
            },
          },
        ],
      },
    });
  });

  const history = await fetchYahooDailyHistory({
    symbol: "HIST-USD",
    startDate: "2024-01-01",
    endDate: "2024-01-04",
  });

  assert.deepEqual(history?.points, [
    { date: "2024-01-01", close: 10 },
    { date: "2024-01-02", close: 20 },
    { date: "2024-01-03", close: 30 },
  ]);
  assert.equal(history?.currency, "USD");
  assert.equal(history?.instrumentType, "CRYPTOCURRENCY");
  assert.equal(history?.name, "Hist Coin USD");
});

test("crypto history from Yahoo is used only for a confirmed USD pair of this very coin", async () => {
  const points = [{ date: "2024-01-01", close: 10 }];
  const historyOf = (overrides) => async () => ({
    points,
    currency: "USD",
    instrumentType: "CRYPTOCURRENCY",
    name: "Chainlink USD",
    ...overrides,
  });
  const run = (fetchHistory, symbol = "LINK", providerId = "chainlink") =>
    fetchYahooCryptoHistoryPoints({
      symbol,
      providerId,
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      fetchHistory,
    });

  assert.deepEqual(await run(historyOf({})), points);
  assert.deepEqual(await run(historyOf({ instrumentType: "EQUITY" })), []);
  assert.deepEqual(await run(historyOf({ currency: "EUR" })), []);
  assert.deepEqual(await run(historyOf({ instrumentType: undefined })), []);
  assert.deepEqual(await run(async () => null), []);
  assert.deepEqual(await run(historyOf({}), "BTC-USD"), []);
  // A major coin is confirmed by its known name, whatever id the asset carries.
  assert.deepEqual(await run(historyOf({}), "LINK", undefined), points);
  // The same ticker on another coin, or a name that does not match, is refused.
  assert.deepEqual(
    await run(historyOf({ name: "ARbit USD" }), "ARB", "arbitrum"),
    []
  );
  assert.deepEqual(await run(historyOf({ name: "Xyz Coin USD" }), "XYZ", undefined), []);
  assert.deepEqual(await run(historyOf({ name: undefined }), "LINK"), []);
});

const benchmarkSeries = () => {
  const day = (date) => Math.floor(Date.parse(`${date}T12:00:00Z`) / 1_000);

  return {
    chart: {
      result: [
        {
          meta: { currency: "USD", instrumentType: "ETF" },
          timestamp: [day("2020-01-02"), day("2021-01-04"), day("2022-01-03")],
          indicators: { quote: [{ close: [100, 120, 150] }] },
        },
      ],
    },
  };
};

test("benchmarks fall back to Yahoo when Stooq reports its daily limit and CoinGecko is limited", async () => {
  const calls = installFetch((url) => {
    if (url.hostname === "stooq.pl") {
      return new Response("Przekroczony dzienny limit wywolan", { status: 200 });
    }
    if (url.hostname === "api.coingecko.com") return new Response("limit", { status: 429 });
    return isYahoo(url) ? json(benchmarkSeries()) : null;
  });

  const comparisons = await buildBenchmarkComparisons([{ date: "2020-01-02", amountPln: 1_000 }]);

  // WIG20 has no Yahoo backup (Yahoo keeps no daily history for it), so it is
  // omitted rather than approximated with a different index.
  assert.deepEqual(
    comparisons.map((comparison) => comparison.id),
    ["sp500", "nasdaq100", "bitcoin"]
  );
  for (const comparison of comparisons) {
    assert.equal(comparison.currentValuePln, 1_500);
    assert.equal(comparison.returnPercent, 50);
  }
  assert.deepEqual(yahooChartSymbols(calls).sort(), ["BTC-USD", "QQQ", "SPY"]);
});

test("benchmarks that Stooq and CoinGecko can serve never reach Yahoo", async () => {
  const csv = [
    "Date,Open,High,Low,Close,Volume",
    "2020-01-02,1,1,1,100,1",
    "2022-01-03,1,1,1,150,1",
  ].join("\n");
  const calls = installFetch((url) => {
    if (url.hostname === "stooq.pl") return new Response(csv, { status: 200 });
    if (url.hostname === "api.coingecko.com") {
      return json({
        prices: [
          [Date.parse("2020-01-02T00:00:00Z"), 100],
          [Date.parse("2022-01-03T00:00:00Z"), 150],
        ],
      });
    }
    return null;
  });

  const comparisons = await buildBenchmarkComparisons([{ date: "2020-01-02", amountPln: 1_000 }]);

  assert.equal(comparisons.length, 4);
  assert.equal(yahooCalls(calls).length, 0);
});

const etfSearchPayload = {
  quotes: [
    { symbol: "TSTA.L", shortname: "Test Global ETF", exchange: "LSE", exchDisp: "London", quoteType: "ETF" },
    { symbol: "TSTA.DE", longname: "Test Global ETF Acc", exchange: "GER", exchDisp: "XETRA", quoteType: "ETF" },
    { symbol: "TSTX", shortname: "Test Corp", exchange: "NMS", exchDisp: "NASDAQ", quoteType: "EQUITY" },
  ],
};

const rateLimitedOpenFigi = {
  searchEtfs: async () => {
    throw new OpenFigiSearchError("rate_limit");
  },
};

test("ETF search falls back to Yahoo ETFs when OpenFIGI is rate limited and nothing else answers", async () => {
  installFetch((url) => (isYahoo(url) ? json(etfSearchPayload) : null));

  const groups = await searchEtfInstruments(`yahoo etf ${Date.now()}`, rateLimitedOpenFigi);
  const listings = groups.flatMap((group) => group.listings);

  assert.deepEqual(
    listings.map((listing) => [listing.providerId, listing.provider, listing.exchange, listing.priceStatus]).sort(),
    [
      ["TSTA.DE", "yahoo", "XETRA", "unchecked"],
      ["TSTA.L", "yahoo", "London", "unchecked"],
    ]
  );
  // Nothing about a Yahoo listing is presented as confirmed.
  assert.ok(listings.every((listing) => listing.instrumentIdentity.currency === undefined));
  assert.ok(listings.every((listing) => listing.instrumentIdentity.figi === undefined));
  assert.ok(listings.every((listing) => /Yahoo$/.test(listing.subtitle)));
});

test("a Yahoo outage keeps the OpenFIGI error and is not remembered once Yahoo recovers", async () => {
  const query = `yahoo recovery ${Date.now()}`;

  installFetch((url) => (isYahoo(url) ? new Response("limit", { status: 429 }) : null));
  await assert.rejects(
    () => searchEtfInstruments(query, rateLimitedOpenFigi),
    (error) => error instanceof OpenFigiSearchError && error.code === "rate_limit"
  );

  installFetch((url) => (isYahoo(url) ? json(etfSearchPayload) : null));
  const groups = await searchEtfInstruments(query, rateLimitedOpenFigi);

  assert.equal(groups.flatMap((group) => group.listings).length, 2);
});

/** A Yahoo-discovered listing as the resolver route receives it from the browser. */
const yahooListingFromBrowser = async (symbol) => {
  const [found] = await searchYahooEtfListings(symbol, async () => [
    { symbol, name: "Test Bond ETF", exchange: "LSE", exchangeDisplay: "London" },
  ]);

  return sanitiseEtfListing(JSON.parse(JSON.stringify(found)));
};

test("a Yahoo listing is confirmed with a live quote that supplies its real currency", async () => {
  const fromBrowser = await yahooListingFromBrowser("TSTB.L");

  assert.equal(fromBrowser?.providerId, "TSTB.L");

  installFetch(
    yahooHandler({ "TSTB.L": yahooChart({ symbol: "TSTB.L", currency: "GBP", price: 4.2 }) })
  );
  const resolved = await resolveEtfListingPriceSource(fromBrowser, async () => []);

  assert.equal(resolved.provider, "yahoo");
  assert.equal(resolved.providerId, "TSTB.L");
  assert.equal(resolved.marketCurrency, "GBP");
  assert.equal(resolved.instrumentIdentity.currency, "GBP");
  assert.equal(resolved.instrumentIdentity.providerPriceSymbol, "TSTB.L");
  assert.equal(resolved.priceStatus, "available");
});

test("a Yahoo listing that Yahoo cannot quote stays unavailable instead of keeping a guessed currency", async () => {
  // A different symbol from the test above: Yahoo quotes are cached for 30 s.
  const fromBrowser = await yahooListingFromBrowser("TSTC.L");

  installFetch(yahooHandler({}));
  const unconfirmed = await resolveEtfListingPriceSource(fromBrowser, async () => []);

  assert.equal(unconfirmed.priceStatus, "unavailable");
  assert.equal(unconfirmed.providerId, undefined);
});

test("a browser cannot make an arbitrary symbol trusted without a Yahoo listing identity", () => {
  const forged = sanitiseEtfListing({
    listingId: "etf:made-up",
    symbol: "ZZZ",
    name: "Forged",
    marketCurrency: "USD",
    provider: "yahoo",
    providerId: "ZZZ.L",
    providerPriceSymbol: "ZZZ.L",
    instrumentIdentity: {
      ticker: "ZZZ",
      name: "Forged",
      instrumentType: "ETF",
      exchangeCode: "LSE",
      currency: "USD",
      providerPriceSymbol: "ZZZ.L",
    },
  });

  assert.equal(forged?.providerId, undefined);
});

const openFigiListing = (overrides = {}) =>
  groupEtfListings("VWRP", [
    {
      ticker: "VWRP",
      name: "Vanguard FTSE All-World UCITS ETF",
      figi: "BBG00YYYYYY1",
      compositeFIGI: "BBG00YYYYYY2",
      shareClassFIGI: "BBG00YYYYYY3",
      exchCode: "LN",
      securityType: "ETP",
      securityType2: "Mutual Fund",
      marketSector: "Equity",
      ...overrides,
    },
  ])[0].listings[0];

test("an OpenFIGI ETF that EODHD cannot price is settled by Yahoo from its venue code", async () => {
  const selected = openFigiListing();

  installFetch(
    yahooHandler({
      "VWRP.L": yahooChart({ symbol: "VWRP.L", currency: "GBP", price: 105.5, instrumentType: "ETF" }),
    })
  );
  // The EODHD lookup failing outright (limit, cache outage) must not stop Yahoo.
  const resolved = await resolveEtfListingPriceSource(selected, async () => {
    throw new Error("EODHD unavailable");
  });

  assert.equal(resolved.provider, "yahoo");
  assert.equal(resolved.providerId, "VWRP.L");
  assert.equal(resolved.marketCurrency, "GBP");
  assert.equal(resolved.instrumentIdentity.currency, "GBP");
  assert.equal(resolved.instrumentIdentity.figi, "BBG00YYYYYY1");
  assert.equal(resolved.priceStatus, "available");
});

test("an OpenFIGI ETF is not settled by Yahoo when Yahoo does not call that symbol an ETF", async () => {
  const selected = openFigiListing({ ticker: "VWRQ", figi: "BBG00ZZZZZZ1" });

  installFetch(
    yahooHandler({
      "VWRQ.L": yahooChart({ symbol: "VWRQ.L", currency: "GBP", price: 3.3, instrumentType: "EQUITY" }),
    })
  );
  const resolved = await resolveEtfListingPriceSource(selected, async () => []);

  assert.equal(resolved.priceStatus, "unavailable");
  assert.equal(resolved.providerId, undefined);
});
