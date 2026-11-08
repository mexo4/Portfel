import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const sourceUrlText = process.env.MEXO_PRIVACY_TEST_DATABASE_URL;
if (!sourceUrlText) throw new Error("MEXO_PRIVACY_TEST_DATABASE_URL is required for the isolated restore drill.");

const sourceUrl = new URL(sourceUrlText);
const sourceDatabase = decodeURIComponent(sourceUrl.pathname.slice(1));
const sourceUser = decodeURIComponent(sourceUrl.username);
if (!new Set(["127.0.0.1", "::1", "localhost"]).has(sourceUrl.hostname) ||
    sourceDatabase !== "mexo_privacy_test" || sourceUser !== "mexo_privacy_test") {
  throw new Error("Refusing backup/restore: source must be loopback mexo_privacy_test owned by mexo_privacy_test.");
}

const targetDatabase = "mexo_privacy_restore_test";
const schema = `privacy_restore_${randomUUID().replaceAll("-", "")}`;
const userId = "privacy-restore-fixture";
const portfolioId = "privacy-restore-portfolio";
const accountId = "privacy-restore-account";
const instrumentId = "privacy-restore-instrument";
const operationId = "privacy-restore-operation";
const tempPrefix = join(tmpdir(), "mexo-privacy-restore-");
const tempDirectory = mkdtempSync(tempPrefix);
const dumpPath = join(tempDirectory, "isolated-test.dump");
const sourcePool = new Pool({ connectionString: sourceUrlText });
const scopedUrl = new URL(sourceUrlText);
scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
const previous = {
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
  ca: process.env.POSTGRES_CA_CERT_BASE64,
  caPath: process.env.POSTGRES_CA_CERT_PATH,
};
let targetCreated = false;
let restorePool;
let scopedPool;

const adminEnv = {
  ...process.env,
  PGHOST: sourceUrl.hostname,
  PGPORT: sourceUrl.port || "5432",
  PGUSER: sourceUser,
  PGPASSWORD: decodeURIComponent(sourceUrl.password),
  PGSSLMODE: "disable",
};

const runPgTool = (command, args, database) => {
  const result = spawnSync(command, args, {
    env: { ...adminEnv, PGDATABASE: database },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed with exit ${String(result.status)}${result.error ? " (tool unavailable)" : ""}.`);
  }
};

const snapshotCounts = async (pool) => {
  const counts = {};
  for (const [table, where] of [
    ["users", "id = $1"],
    ["core_portfolios", "user_id = $1"],
    ["core_accounts", "portfolio_id IN (SELECT id FROM core_portfolios WHERE user_id = $1)"],
    ["core_instruments", "portfolio_id IN (SELECT id FROM core_portfolios WHERE user_id = $1)"],
    ["core_operations", "portfolio_id IN (SELECT id FROM core_portfolios WHERE user_id = $1)"],
  ]) {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`, [userId]);
    counts[table] = result.rows[0].count;
  }
  const identifiers = await pool.query(
    `SELECT string_agg(id || ':' || amount::text || ':' || currency, ',' ORDER BY id) AS value
     FROM core_operations WHERE portfolio_id IN (SELECT id FROM core_portfolios WHERE user_id = $1)`,
    [userId]
  );
  const orphanCount = await pool.query(
    `SELECT count(*)::int AS count FROM core_operations o
     JOIN core_portfolios p ON p.id = o.portfolio_id
     LEFT JOIN core_accounts a ON a.id = o.account_id
     LEFT JOIN core_instruments i ON i.id = o.asset_id
     WHERE p.user_id = $1 AND (a.id IS NULL OR a.portfolio_id <> o.portfolio_id OR
       (o.asset_id IS NOT NULL AND (i.id IS NULL OR i.portfolio_id <> o.portfolio_id)))`,
    [userId]
  );
  return { counts, identifiers: identifiers.rows[0].value, orphans: orphanCount.rows[0].count };
};

try {
  const existingTarget = await sourcePool.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDatabase]);
  assert.equal(existingTarget.rowCount, 0, "restore target must not already exist; refusing to overwrite it");
  await sourcePool.query(`CREATE SCHEMA ${schema}`);

  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.NODE_ENV = "test";
  process.env.POSTGRES_CA_CERT_BASE64 = "";
  process.env.POSTGRES_CA_CERT_PATH = "";
  const { initializeDatabase, execute } = await import("../src/lib/server/db.ts");
  await initializeDatabase();
  await initializeDatabase();
  scopedPool = new Pool({ connectionString: scopedUrl.toString() });

  const now = new Date().toISOString();
  await execute(`INSERT INTO users (id,email,display_name,profile_json,portfolio_json,created_at,updated_at)
    VALUES ($1,'restore@example.invalid','Backup Fixture','{}','{}',$2,$2)`, [userId, now]);
  await execute(`INSERT INTO core_portfolios (id,user_id,name,base_currency,created_at,updated_at)
    VALUES ($1,$2,'Portfel testowy','PLN',$3,$3)`, [portfolioId, userId, now]);
  await execute(`INSERT INTO core_accounts (id,portfolio_id,name,kind,currency,created_at,updated_at)
    VALUES ($1,$2,'Konto PLN','CASH','PLN',$3,$3)`, [accountId, portfolioId, now]);
  await execute(`INSERT INTO core_instruments (id,portfolio_id,type,asset_kind,symbol,name,market_currency,created_at,updated_at)
    VALUES ($1,$2,'STOCK','STOCK','DNP.PL','Dino Polska','PLN',$3,$3)`, [instrumentId, portfolioId, now]);
  await execute(`INSERT INTO core_operations (id,portfolio_id,account_id,asset_id,operation_type,quantity,price,currency,amount,date,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'BUY',123.45678901234567,9876.543210987654,'PLN',1219326.3117057615,'2026-01-02',$5,$5)`,
  [operationId, portfolioId, accountId, instrumentId, now]);

  const sourceBefore = await snapshotCounts(scopedPool);
  assert.equal(sourceBefore.orphans, 0);
  runPgTool("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--schema", schema, "--file", dumpPath], sourceDatabase);
  const list = spawnSync("pg_restore", ["--list", dumpPath], { encoding: "utf8", windowsHide: true });
  if (list.error || list.status !== 0 || !list.stdout.includes(schema) || !list.stdout.includes("core_operations")) {
    throw new Error("pg_restore listing did not contain the actual Mexo schema and operations table.");
  }
  await scopedPool.end();
  scopedPool = undefined;
  await globalThis.portfelPostgresPool?.end();
  globalThis.portfelPostgresPool = undefined;
  globalThis.portfelSchemaInitialization = null;

  runPgTool("createdb", ["--no-password", targetDatabase], sourceDatabase);
  targetCreated = true;
  // pg_restore's --schema option filters the archive to the selected schema's
  // objects; it does not guarantee that the schema namespace itself is emitted.
  // Create it explicitly in this brand-new isolated restore database first.
  runPgTool("psql", [
    "--no-password",
    "--set", "ON_ERROR_STOP=1",
    "--dbname", targetDatabase,
    "--command", `CREATE SCHEMA "${schema}"`,
  ], sourceDatabase);
  runPgTool("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--schema", schema, "--dbname", targetDatabase, dumpPath], sourceDatabase);
  const targetUrl = new URL(sourceUrlText);
  targetUrl.pathname = `/${targetDatabase}`;
  targetUrl.searchParams.set("options", `-csearch_path=${schema}`);
  restorePool = new Pool({ connectionString: targetUrl.toString() });
  const restored = await snapshotCounts(restorePool);
  assert.deepEqual(restored, sourceBefore, "restored user, portfolio, account, instrument, operation IDs, stored amounts and references must match");
  console.log("PASS isolated pg_dump/pg_restore drill: actual Mexo schema; account/portfolio/account/instrument/operation counts, stable IDs, stored precision/currency and foreign-key references match.");
} finally {
  await restorePool?.end();
  await scopedPool?.end();
  await globalThis.portfelPostgresPool?.end();
  globalThis.portfelPostgresPool = undefined;
  globalThis.portfelSchemaInitialization = null;
  if (targetCreated) {
    await sourcePool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [targetDatabase]);
    await sourcePool.query(`DROP DATABASE ${targetDatabase}`);
  }
  await sourcePool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await sourcePool.end();
  if (tempDirectory.startsWith(tempPrefix)) rmSync(tempDirectory, { recursive: true, force: true });
  if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.databaseUrl;
  if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
  if (previous.ca === undefined) delete process.env.POSTGRES_CA_CERT_BASE64; else process.env.POSTGRES_CA_CERT_BASE64 = previous.ca;
  if (previous.caPath === undefined) delete process.env.POSTGRES_CA_CERT_PATH; else process.env.POSTGRES_CA_CERT_PATH = previous.caPath;
}
