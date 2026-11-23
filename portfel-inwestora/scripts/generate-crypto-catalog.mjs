// Rebuilds the entries of `src/lib/crypto-catalog.ts`.
//
//   node scripts/generate-crypto-catalog.mjs > /tmp/entries.txt
//
// It prints one `{ symbol, name, coingeckoId, binancePair }` line per coin to
// paste between the brackets of `CRYPTO_CATALOG`. Read-only: two public GET
// requests to Binance and three to CoinGecko (free plan, hence the pauses).
//
// A coin is listed only when
//   - its USDT pair is TRADING on Binance spot,
//   - it is in the CoinGecko top 200 by market cap, and
//   - the Binance price is within 3% of CoinGecko's price. That is what proves
//     the pair is the same asset: a ticker alone is not an identity.
// Stablecoins and commodity-backed / tokenised-stock tokens are left out.
// Names and search terms below are hand-kept: check them after a rebuild.

const EXCLUDED_SYMBOLS = new Set([
  "USDC", "USDS", "USDE", "USD1", "RLUSD", "U", "BFUSD", "TUSD", "FDUSD", "USDT", "DAI", "PYUSD",
  "XAUT", "PAXG", "NVDAB",
]);
const NAME_OVERRIDES = { GRAM: "Toncoin" };
const SEARCH_TERMS = {
  GRAM: ["ton", "toncoin", "the open network"],
  POL: ["matic", "polygon"],
  RENDER: ["rndr"],
  FET: ["asi", "fetch"],
  STX: ["stacks"],
  LUNC: ["luna classic"],
  IOTA: ["miota"],
};
const TOP_RANK = 200;
const MAX_PRICE_DEVIATION = 0.03;

const getJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });

  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }

  return response.json();
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [exchangeInfo, tickerPrices] = await Promise.all([
  getJson("https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT"),
  getJson("https://api.binance.com/api/v3/ticker/price"),
]);
const binancePriceByPair = new Map(tickerPrices.map((ticker) => [ticker.symbol, Number(ticker.price)]));
const binanceByBase = new Map(
  exchangeInfo.symbols
    .filter((entry) => entry.status === "TRADING" && entry.quoteAsset === "USDT" && entry.isSpotTradingAllowed)
    .map((entry) => [entry.baseAsset, { pair: entry.symbol, price: binancePriceByPair.get(entry.symbol) }])
);

const markets = [];

for (const page of [1, 2]) {
  markets.push(
    ...(await getJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`
    ))
  );
  await pause(2_500);
}

const seenSymbols = new Set();
const lines = [];

for (const coin of markets) {
  const symbol = coin.symbol.toUpperCase();

  // The first (best ranked) coin of a symbol wins; its namesakes are never listed.
  if (!coin.market_cap_rank || coin.market_cap_rank > TOP_RANK || seenSymbols.has(symbol)) continue;
  seenSymbols.add(symbol);

  const binance = binanceByBase.get(symbol);

  if (!binance || EXCLUDED_SYMBOLS.has(symbol) || !/^[A-Z0-9]+$/.test(symbol)) continue;

  const deviation = Math.abs(binance.price / coin.current_price - 1);

  if (!(deviation <= MAX_PRICE_DEVIATION)) {
    console.error(`skipped ${symbol} (${coin.id}): Binance ${binance.price} vs CoinGecko ${coin.current_price}`);
    continue;
  }

  const terms = SEARCH_TERMS[symbol];
  lines.push(
    `  { symbol: ${JSON.stringify(symbol)}, name: ${JSON.stringify(NAME_OVERRIDES[symbol] ?? coin.name)}, ` +
      `coingeckoId: ${JSON.stringify(coin.id)}, binancePair: ${JSON.stringify(binance.pair)}` +
      `${terms ? `, searchTerms: ${JSON.stringify(terms)}` : ""} },`
  );
}

console.log(lines.join("\n"));
console.error(`${lines.length} coins`);
