import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fetchBinanceDailyCloses,
  parseBinanceKlines,
} from "../src/lib/server/binance-history.ts";

const DAY_MS = 86_400_000;
const dayMs = (date) => Date.parse(`${date}T00:00:00.000Z`);
const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** `count` daily candles from `startDate`, the way Binance returns them. */
const candles = (startDate, count, closeOf = (index) => 100 + index) =>
  Array.from({ length: count }, (_, index) => {
    const openTime = dayMs(startDate) + index * DAY_MS;
    return [openTime, "1", "2", "0.5", String(closeOf(index)), "10", openTime + DAY_MS - 1];
  });

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("klines are read as dated closes, oldest first, without broken rows", () => {
  const parsed = parseBinanceKlines([
    [dayMs("2026-01-02"), "1", "2", "0.5", "11.5", "10"],
    [dayMs("2026-01-01"), "1", "2", "0.5", "10.25", "10"],
    [dayMs("2026-01-03"), "1", "2", "0.5", "0", "10"],
    [dayMs("2026-01-04"), "1", "2", "0.5", "not-a-number", "10"],
    "garbage",
  ]);

  assert.deepEqual(parsed, [
    { date: "2026-01-01", close: 10.25 },
    { date: "2026-01-02", close: 11.5 },
  ]);
  assert.deepEqual(parseBinanceKlines({ code: -1121, msg: "Invalid symbol." }), []);
});

test("a range longer than one page is fetched page by page and joined", async () => {
  const requests = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const startMs = Number(url.searchParams.get("startTime"));

    return jsonResponse(
      candles(dateOf(startMs), startMs === dayMs("2023-01-01") ? 1_000 : 200)
    );
  };

  const closes = await fetchBinanceDailyCloses({
    pair: "PEPEUSDT",
    startDate: "2023-01-01",
    endDate: "2026-11-23",
    fetchImpl,
  });

  assert.equal(requests.length, 2);
  assert.equal(closes.length, 1_200);
  assert.equal(new Set(closes.map((point) => point.date)).size, 1_200, "no day twice");
  assert.equal(closes[0].date, "2023-01-01");
  // The second page starts the day after the first page's last candle.
  assert.equal(
    dateOf(Number(requests[1].searchParams.get("startTime"))),
    dateOf(dayMs("2023-01-01") + 1_000 * DAY_MS)
  );
  assert.equal(requests[0].searchParams.get("symbol"), "PEPEUSDT");
  assert.equal(requests[0].searchParams.get("interval"), "1d");
  assert.equal(requests[0].searchParams.get("limit"), "1000");
  assert.equal(
    Number(requests[0].searchParams.get("endTime")),
    dayMs("2026-11-23") + DAY_MS - 1,
    "the end day is included"
  );
});

test("a failed request is no history rather than an error, and a bad pair is never sent", async () => {
  const failing = await fetchBinanceDailyCloses({
    pair: "PEPEUSDT",
    startDate: "2026-01-01",
    endDate: "2026-02-01",
    fetchImpl: async () => jsonResponse({ code: -1003, msg: "Too many requests" }, 429),
  });
  const throwing = await fetchBinanceDailyCloses({
    pair: "PEPEUSDT",
    startDate: "2026-01-01",
    endDate: "2026-02-01",
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  let called = false;
  const badPair = await fetchBinanceDailyCloses({
    pair: "PEPE/USDT?x=1",
    startDate: "2026-01-01",
    endDate: "2026-02-01",
    fetchImpl: async () => {
      called = true;
      return jsonResponse([]);
    },
  });

  assert.deepEqual(failing, []);
  assert.deepEqual(throwing, []);
  assert.deepEqual(badPair, []);
  assert.equal(called, false);
});

// The history path needs the market cache (a database), which no test here uses,
// so the order of the sources is pinned on the code itself.
test("crypto history asks CoinGecko, then Binance by coin id, then Yahoo, and only on a miss", async () => {
  // The working copy may use CRLF line endings on Windows.
  const source = (
    await readFile(new URL("../src/lib/server/portfolio-history.ts", import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");
  const start = source.indexOf('if (resolvedKind === "crypto") {');
  const end = source.indexOf("Brakuje historii cen", start);

  assert.ok(start > -1 && end > start, "crypto branch of fetchInstrumentHistory not found");

  const code = source.slice(start, end);
  const coinGecko = code.indexOf("fetchCoinGeckoHistory(");
  const binance = code.indexOf("fetchBinanceCryptoHistory(");
  const yahoo = code.indexOf("fetchYahooCryptoHistory(");

  assert.ok(coinGecko > -1 && binance > coinGecko && yahoo > binance, "order: CoinGecko, Binance, Yahoo");
  // Binance never runs next to a working CoinGecko, and Yahoo only when Binance had nothing.
  assert.ok(
    code.includes("coinGeckoPoints.length > 0\n          ? []\n          : (await fetchBinanceCryptoHistory("),
    "Binance is asked only after a CoinGecko miss"
  );
  assert.ok(
    code.includes("binancePoints.length > 0\n            ? binancePoints"),
    "Yahoo is asked only after a Binance miss"
  );
  // The pair is chosen by CoinGecko id, never by ticker, and has its own cache family.
  assert.ok(source.includes("Object.hasOwn(CRYPTO_BINANCE_PAIR_BY_COINGECKO_ID, coinId)"));
  assert.ok(source.includes("`portfolio-history:v2:binance:${pair}:${startDate}`"));
});
