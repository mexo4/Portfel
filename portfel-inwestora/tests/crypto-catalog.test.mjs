import assert from "node:assert/strict";
import test from "node:test";

// These tests must never reach a real database or API. The modules below read
// their environment when they load, so it is prepared before the imports.
for (const name of ["DATABASE_URL", "POSTGRES_CA_CERT_PATH", "POSTGRES_CA_CERT_BASE64"]) {
  delete process.env[name];
}

const {
  CRYPTO_ASSET_CATALOG,
  CRYPTO_BINANCE_PAIR_BY_COINGECKO_ID,
  CRYPTO_CATALOG,
  CRYPTO_COINGECKO_ID_BY_SYMBOL,
} = await import("../src/lib/crypto-catalog.ts");
const { searchCatalogAssets } = await import("../src/lib/search.ts");
const { fetchAssetQuoteServer } = await import("../src/lib/server/market-data.ts");

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const installFetch = (handler) => {
  const calls = [];

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return handler(url) ?? new Response("not found", { status: 404 });
  };

  return calls;
};

const search = (query) => searchCatalogAssets(query, "crypto", "crypto");

test("the catalogue has one entry per symbol, coin id and Binance pair", () => {
  assert.ok(CRYPTO_CATALOG.length >= 50);

  for (const field of ["symbol", "coingeckoId", "binancePair"]) {
    const values = CRYPTO_CATALOG.map((entry) => entry[field]);
    assert.equal(new Set(values).size, values.length, `duplicate ${field}`);
  }

  for (const entry of CRYPTO_CATALOG) {
    assert.match(entry.symbol, /^[A-Z0-9]+$/);
    assert.match(entry.coingeckoId, /^[a-z0-9-]+$/);
    assert.equal(entry.binancePair, `${entry.symbol}USDT`);
    assert.ok(entry.name.trim());
  }
});

test("stablecoins and commodity tokens are not offered as crypto positions", () => {
  const symbols = new Set(CRYPTO_CATALOG.map((entry) => entry.symbol));

  for (const excluded of ["USDC", "USDS", "USDE", "FDUSD", "TUSD", "XAUT", "PAXG"]) {
    assert.equal(symbols.has(excluded), false, `${excluded} must not be listed`);
  }
});

test("the ten coins that had a hard-coded Binance pair keep their CoinGecko id and pair", () => {
  const legacy = {
    BTC: ["bitcoin", "BTCUSDT"],
    ETH: ["ethereum", "ETHUSDT"],
    BNB: ["binancecoin", "BNBUSDT"],
    SOL: ["solana", "SOLUSDT"],
    XRP: ["ripple", "XRPUSDT"],
    ADA: ["cardano", "ADAUSDT"],
    DOGE: ["dogecoin", "DOGEUSDT"],
    DOT: ["polkadot", "DOTUSDT"],
    TRX: ["tron", "TRXUSDT"],
    AVAX: ["avalanche-2", "AVAXUSDT"],
  };

  for (const [symbol, [coinId, pair]] of Object.entries(legacy)) {
    assert.equal(CRYPTO_COINGECKO_ID_BY_SYMBOL[symbol], coinId);
    assert.equal(CRYPTO_BINANCE_PAIR_BY_COINGECKO_ID[coinId], pair);
  }
});

test("every catalogue coin is a local search result with the CoinGecko id as provider id", () => {
  assert.equal(CRYPTO_ASSET_CATALOG.length, CRYPTO_CATALOG.length);

  const [solana] = search("sol");

  assert.equal(solana.symbol, "SOL");
  assert.equal(solana.name, "Solana");
  assert.equal(solana.kind, "crypto");
  assert.equal(solana.provider, "coingecko");
  assert.equal(solana.providerId, "solana");
  assert.equal(solana.marketCurrency, "USD");
  assert.equal(solana.source, "catalog");
});

test("a ticker with a dozen namesakes finds the one coin that has a price", () => {
  const pepe = search("pepe");

  assert.equal(pepe.length, 1);
  assert.equal(pepe[0].providerId, "pepe");
});

test("former names and spellings find the coin that was renamed", () => {
  assert.equal(search("matic")[0].symbol, "POL");
  assert.equal(search("ton")[0].symbol, "GRAM");
  assert.equal(search("toncoin")[0].symbol, "GRAM");
  assert.equal(search("bitcoin")[0].symbol, "BTC");
});

test("the price source in the subtitle does not make every coin match a short query", () => {
  const results = search("bi");

  assert.ok(results.length > 0);
  assert.ok(results.length < CRYPTO_CATALOG.length);
  assert.ok(
    results.every((item) =>
      // The CoinGecko id is a search term of the entry and the result's provider id.
      [item.name, item.symbol, item.providerId].join(" ").toLowerCase().includes("bi")
    ),
    "a result matched only through its subtitle"
  );
  assert.equal(search("zzzz").length, 0);
  // "binance" is in every subtitle and in no name, symbol or id except BNB's.
  assert.deepEqual(search("binance").map((item) => item.symbol), ["BNB"]);
});

test("a catalogue coin is priced by its own Binance pair", async () => {
  const calls = installFetch((url) =>
    url.hostname === "api.binance.com"
      ? json({ lastPrice: "0.00001234", prevClosePrice: "0.00001200", closeTime: Date.now() - 1_000 })
      : null
  );

  const quote = await fetchAssetQuoteServer({
    symbol: "PEPE",
    kind: "crypto",
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: "pepe",
  });

  assert.equal(quote?.provider, "binance");
  // Rounded to four decimals this was 0, i.e. no usable price for PEPE.
  assert.equal(quote?.price, 0.00001234);
  assert.equal(quote?.previousClose, 0.000012);
  assert.deepEqual(
    calls.filter((url) => url.hostname === "api.binance.com").map((url) => url.searchParams.get("symbol")),
    ["PEPEUSDT"]
  );
});

test("another coin that shares a catalogue ticker never gets that coin's Binance price", async () => {
  const calls = installFetch((url) =>
    url.hostname === "api.binance.com"
      ? json({ lastPrice: "1.00", prevClosePrice: "1.00", closeTime: Date.now() - 1_000 })
      : new Response("limit", { status: 429 })
  );

  const quote = await fetchAssetQuoteServer({
    symbol: "SOL",
    kind: "crypto",
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: "wormhole-sol-impostor",
  });

  assert.equal(
    calls.filter((url) => url.hostname === "api.binance.com").length,
    0,
    "the SOL pair belongs to the coin id `solana`, not to any coin called SOL"
  );
  assert.equal(quote?.provider === "binance", false);
});

test("a coin saved by symbol only is resolved to the catalogue coin, not to a search guess", async () => {
  const calls = installFetch((url) =>
    url.hostname === "api.binance.com"
      ? json({ lastPrice: "5.50", prevClosePrice: "5.00", closeTime: Date.now() - 1_000 })
      : null
  );

  const quote = await fetchAssetQuoteServer({
    symbol: "UNI",
    kind: "crypto",
    marketCurrency: "USD",
    provider: "coingecko",
  });

  assert.equal(quote?.provider, "binance");
  assert.equal(
    calls.some((url) => url.hostname === "api.coingecko.com" && url.pathname.endsWith("/search")),
    false,
    "no CoinGecko search is needed for a catalogue symbol"
  );
  assert.equal(
    calls.find((url) => url.hostname === "api.binance.com")?.searchParams.get("symbol"),
    "UNIUSDT"
  );
});

test("CoinGecko search results with the same symbol put the established coin first", async () => {
  const { searchMarketAssets } = await import("../src/lib/server/market-data.ts");

  installFetch((url) =>
    url.hostname === "api.coingecko.com" && url.pathname === "/api/v3/search"
      ? json({
          coins: [
            { id: "zzcoin-clone", name: "Based Zzcoin", symbol: "ZZCOIN", market_cap_rank: null },
            { id: "zzcoin-tiny", name: "Zzcoin Tiny", symbol: "ZZCOIN", market_cap_rank: 2400 },
            { id: "zzcoin", name: "Zzcoin", symbol: "ZZCOIN", market_cap_rank: 41 },
            { id: "zzcoin-top", name: "Zzcoin Top", symbol: "ZZCOIN", market_cap_rank: 7 },
          ],
        })
      : null
  );

  const results = await searchMarketAssets("zzcoin", "crypto", "crypto");

  // By rank, not by name ("Based Zzcoin" sorts first alphabetically); no rank goes last.
  assert.deepEqual(
    results.map((result) => result.providerId),
    ["zzcoin-top", "zzcoin", "zzcoin-tiny", "zzcoin-clone"]
  );
});

test("a unit price of a few millionths is shown with its digits, not as zero", async () => {
  const { formatCurrency } = await import("../src/lib/utils.ts");

  assert.match(formatCurrency(0.00000353, "USD"), /0,00000353/);
  assert.match(formatCurrency(0.0000137, "PLN"), /0,0000137/);
  // Ordinary prices keep their fixed decimals.
  assert.match(formatCurrency(61734.92, "USD"), /734,92/);
  assert.match(formatCurrency(0.5, "PLN"), /0,50/);
  assert.match(formatCurrency(0, "PLN"), /0,00/);
});
