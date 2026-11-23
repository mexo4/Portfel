import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Nothing here may reach a real database; the store gets a fake one.
for (const name of ["DATABASE_URL", "POSTGRES_CA_CERT_PATH", "POSTGRES_CA_CERT_BASE64"]) {
  delete process.env[name];
}

const {
  MAX_STORED_HISTORIES_PER_USER,
  MAX_STORED_HISTORY_CHARS,
  createPortfolioHistoryStore,
} = await import("../src/lib/server/portfolio-history-store.ts");
const { PORTFOLIO_HISTORY_RESPONSE_TTL_MS } = await import(
  "../src/lib/server/portfolio-history-cache-policy.ts"
);

const NOW = Date.parse("2026-11-23T12:00:00.000Z");

const history = (marker = 1) => ({
  points: [{ date: "2026-11-23", portfolioValuePln: marker }],
  warnings: [],
  assetSeries: [],
  benchmarkSeries: [],
});

const fakeDatabase = (row) => {
  const calls = [];

  return {
    calls,
    queryOne: async (sql, params) => {
      calls.push({ kind: "queryOne", sql, params });
      return row;
    },
    execute: async (sql, params) => {
      calls.push({ kind: "execute", sql, params });
    },
  };
};

const rowAt = (ageMs, payload = history()) => ({
  payload_json: typeof payload === "string" ? payload : JSON.stringify(payload),
  updated_at: new Date(NOW - ageMs).toISOString(),
});

test("a stored history is read by user and key, and returned while it is under an hour old", async () => {
  const database = fakeDatabase(rowAt(59 * 60_000));
  const store = createPortfolioHistoryStore(database);

  assert.deepEqual(await store.read("user-a", "7:abc", NOW), history());
  assert.deepEqual(database.calls[0].params, ["user-a", "7:abc"]);
  assert.match(database.calls[0].sql, /WHERE user_id = \$1 AND cache_key = \$2/);
});

test("a stored history older than the hour, from the future, or damaged is a miss", async () => {
  const read = (row) => createPortfolioHistoryStore(fakeDatabase(row)).read("user-a", "k", NOW);

  assert.equal(await read(rowAt(PORTFOLIO_HISTORY_RESPONSE_TTL_MS + 1)), null);
  assert.equal(await read(rowAt(-10 * 60_000)), null, "a clock ten minutes ahead is not trusted");
  assert.equal(await read({ payload_json: "{not json", updated_at: new Date(NOW).toISOString() }), null);
  assert.equal(await read(rowAt(1_000, { points: "nope", warnings: [], benchmarkSeries: [] })), null);
  assert.equal(await read(rowAt(1_000, { points: [], warnings: [] })), null);
  assert.equal(await read({ payload_json: JSON.stringify(history()), updated_at: "garbage" }), null);
  assert.equal(await read(undefined), null);
});

test("a database error reaches the caller, which treats it as a miss", async () => {
  const store = createPortfolioHistoryStore({
    queryOne: async () => {
      throw new Error("database unavailable");
    },
    execute: async () => undefined,
  });

  await assert.rejects(store.read("user-a", "k", NOW), /database unavailable/);
});

test("storing a history upserts it and then prunes the user's rows to the hour and the newest few", async () => {
  const database = fakeDatabase(undefined);
  const store = createPortfolioHistoryStore(database);

  await store.store("user-a", "7:abc", history(42), NOW);

  assert.equal(database.calls.length, 2);

  const [upsert, prune] = database.calls;

  assert.match(upsert.sql, /INSERT INTO user_portfolio_history_cache/);
  assert.match(upsert.sql, /ON CONFLICT \(user_id, cache_key\) DO UPDATE/);
  assert.deepEqual(upsert.params, ["user-a", "7:abc", JSON.stringify(history(42)), new Date(NOW).toISOString()]);

  assert.match(prune.sql, /DELETE FROM user_portfolio_history_cache/);
  assert.match(prune.sql, /WHERE user_id = \$1/);
  assert.deepEqual(prune.params, [
    "user-a",
    new Date(NOW - PORTFOLIO_HISTORY_RESPONSE_TTL_MS).toISOString(),
    MAX_STORED_HISTORIES_PER_USER,
  ]);
});

test("one huge history is not stored at all", async () => {
  const database = fakeDatabase(undefined);
  const store = createPortfolioHistoryStore(database);

  await store.store("user-a", "k", history("x".repeat(MAX_STORED_HISTORY_CHARS + 1)), NOW);

  assert.equal(database.calls.length, 0);
});

const readSource = async (relativePath) =>
  (await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("the stored histories belong to the user: own table, removed with the account, not exported", async () => {
  const schema = await readSource("src/lib/server/db.ts");
  const table = schema.match(/CREATE TABLE IF NOT EXISTS user_portfolio_history_cache \(([\s\S]*?)\n    \)/);

  assert.ok(table, "table definition not found");
  assert.match(table[1], /user_id TEXT NOT NULL/);
  assert.match(table[1], /PRIMARY KEY \(user_id, cache_key\)/);
  assert.match(table[1], /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);

  // Never in the shared market-data table, whose rows are kept when an account is deleted.
  const store = await readSource("src/lib/server/portfolio-history-store.ts");
  assert.doesNotMatch(store, /from "@\/lib\/server\/market-cache"/);
  assert.doesNotMatch(store, /(FROM|INTO|UPDATE)\s+market_cache/i);

  const inventory = await readFile(new URL("../../docs/privacy-data-inventory.md", import.meta.url), "utf8");
  assert.match(inventory, /user_portfolio_history_cache/);
});

test("the route serves memory, then the stored copy, then builds; a manual refresh skips both", async () => {
  const route = await readSource("src/app/api/portfolio-history/route.ts");
  const flow = route.slice(route.indexOf("const getOrBuildHistoryResponse"), route.indexOf("const currentHistoryDate"));
  const memory = flow.indexOf("getCachedPortfolioHistoryResponse(key)");
  const stored = flow.indexOf("readStoredPortfolioHistory(userId, storeKey)");
  const built = flow.indexOf("await build()");

  assert.ok(memory > -1 && stored > memory && built > stored, "order: memory, stored copy, build");
  // Both reads sit behind the refresh flag.
  assert.equal(flow.split("if (!forceRefresh)").length - 1, 2);
  // What was built is kept in memory and stored for the next reload, without waiting for the write.
  assert.match(flow, /setCachedPortfolioHistoryResponse\(key, built\);\n\s+void storePortfolioHistory\(userId, storeKey, built\)\.catch\(logHistoryStoreFailure\)/);
  assert.match(route, /const forceRefresh = payload\.forceRefresh === true;/);
  // Both request shapes (all portfolios, one portfolio) pass the flag and the user.
  assert.equal(route.split("{ userId: accountData.user.id, key: historyKey, storeKey, forceRefresh }").length - 1, 2);
});

test("the route's key ignores what a quote refresh rewrites, so a reload finds the stored history", async () => {
  const route = await readSource("src/app/api/portfolio-history/route.ts");

  for (const field of ["priceSource", "latestPrice", "previousClose", "lastUpdatedAt"]) {
    assert.ok(route.includes(`"${field}"`), `${field} must be left out of the key`);
  }

  assert.match(route, /assets: portfolioState\.assets\.map\(withoutHistoryIrrelevantFields\)/);
});
