import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import test from "node:test";
import { resolveEffectiveEntitlements } from "../src/lib/entitlements.ts";
import { AUTH_RATE_LIMIT_POLICIES } from "../src/lib/server/auth-rate-limit.ts";
import { applyAuthRateLimit } from "../src/lib/server/auth-rate-limit-response.ts";

const databaseUrl = process.env.MEXO_HARDENING_TEST_DATABASE_URL;
const rateLimitTestSecret = "mexo-local-postgres-test-secret-32-bytes-minimum";

const runRateLimitWorker = (databaseUrl, requestCount, now) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "--import",
    "./tests/register-alias-loader.mjs",
    "./tests/fixtures/public-release-rate-limit-worker.mjs",
    String(requestCount),
    String(now),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      MEXO_RATE_LIMIT_HMAC_KEY: rateLimitTestSecret,
      MEXO_TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => {
    if (code !== 0) {
      reject(new Error(`Rate-limit worker exited with ${code}: ${stderr}`));
      return;
    }
    try {
      resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1)));
    } catch (error) {
      reject(error);
    }
  });
});

test("isolated PostgreSQL hardening migration and limiter are idempotent and cross-process atomic", {
  skip: !databaseUrl,
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(parsed.hostname),
    "hardening integration tests only accept loopback PostgreSQL");
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(decodeURIComponent(parsed.username), "mexo_hardening_test");
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), "mexo_hardening_test");

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRateLimitSecret = process.env.MEXO_RATE_LIMIT_HMAC_KEY;
  const previousTrustedHeader = process.env.MEXO_TRUSTED_CLIENT_IP_HEADER;
  const schema = `public_release_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: databaseUrl });
  let appPool;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    await adminPool.query(`
      CREATE TABLE "${schema}".users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        subscription_plan TEXT NOT NULL DEFAULT 'free',
        subscription_status TEXT NOT NULL DEFAULT 'active',
        profile_json TEXT NOT NULL,
        portfolio_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await adminPool.query(`
      INSERT INTO "${schema}".users
        (id, email, password_hash, display_name, subscription_plan, subscription_status,
         profile_json, portfolio_json, created_at, updated_at)
      VALUES
        ('legacy-free', 'legacy-free@example.invalid', 'fixture', 'Legacy Free', 'free', 'active', '{}', '{"schemaVersion":2,"portfolios":[]}', now()::text, now()::text),
        ('legacy-pro', 'legacy-pro@example.invalid', 'fixture', 'Legacy Pro', 'pro', 'active', '{}', '{"schemaVersion":2,"portfolios":[]}', now()::text, now()::text)
    `);

    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    process.env.NODE_ENV = "test";

    const { execute, initializeDatabase, query } = await import("../src/lib/server/db.ts");
    await initializeDatabase();
    await initializeDatabase();

    const migrated = await query(`
      SELECT id, subscription_plan, subscription_status, user_role, tester_access, espi_access
      FROM users WHERE id IN ('legacy-free', 'legacy-pro') ORDER BY id
    `);
    assert.deepEqual(migrated.map((row) => [row.id, row.subscription_plan, row.user_role, row.tester_access, row.espi_access]), [
      ["legacy-free", "free", "user", false, false],
      ["legacy-pro", "pro", "user", false, false],
    ]);
    assert.ok(migrated.every((row) => row.subscription_status === "active"));

    await execute(`
      INSERT INTO users (id, email, display_name, profile_json, portfolio_json, created_at, updated_at)
      VALUES ('new-user', 'new-user@example.invalid', 'New User', '{}', '{"schemaVersion":2,"portfolios":[]}', now()::text, now()::text)
    `);
    const [newUser] = await query(`SELECT subscription_plan, user_role, tester_access, espi_access FROM users WHERE id = 'new-user'`);
    assert.deepEqual(newUser, { subscription_plan: "free", user_role: "user", tester_access: false, espi_access: false });

    await execute(`
      INSERT INTO users
        (id, email, password_hash, display_name, user_role, profile_json, portfolio_json, created_at, updated_at)
      VALUES
        ('test-admin', 'test-admin@example.invalid', 'fixture', 'Admin Fixture', 'admin', '{}', '{"schemaVersion":2,"portfolios":[]}', now()::text, now()::text)
    `);
    const { updateCurrentUserSubscription, updateUserAccessByAdmin } = await import("../src/lib/server/auth.ts");
    await assert.rejects(
      updateUserAccessByAdmin("legacy-free", "new-user", { role: "admin" }),
      /Brak roli administratora/
    );
    await assert.rejects(
      updateUserAccessByAdmin("new-user", "new-user", { role: "admin" }),
      /Nie możesz zmienić własnych uprawnień/
    );
    const granted = await updateUserAccessByAdmin("test-admin", "new-user", {
      role: "admin",
      testerAccess: true,
      espiAccess: true,
      subscriptionPlan: "pro",
    });
    assert.deepEqual(
      [granted.role, granted.testerAccess, granted.espiAccess, granted.subscriptionPlan],
      ["admin", true, true, "pro"]
    );
    assert.match(granted.subscriptionExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
    await assert.rejects(updateCurrentUserSubscription("new-user", "expert"), /Płatne plany wymagają/);
    const [portfolioBeforeExpiry] = await query("SELECT portfolio_json FROM users WHERE id = 'new-user'");
    await execute("UPDATE users SET subscription_expires_at = $1 WHERE id = 'new-user'", [new Date(Date.now() - 60_000).toISOString()]);
    const expiredView = await updateUserAccessByAdmin("test-admin", "new-user", { testerAccess: true });
    const effectiveExpired = resolveEffectiveEntitlements(expiredView);
    assert.equal(effectiveExpired.assignedPlan, "pro");
    assert.equal(effectiveExpired.effectivePlan, "free");
    assert.equal(effectiveExpired.isExpired, true);
    assert.equal(expiredView.role, "admin");
    assert.equal(expiredView.testerAccess, true);
    assert.equal(expiredView.espiAccess, true);
    const [portfolioAfterExpiry] = await query("SELECT portfolio_json FROM users WHERE id = 'new-user'");
    assert.equal(portfolioAfterExpiry.portfolio_json, portfolioBeforeExpiry.portfolio_json,
      "plan expiry changes effective access, not user portfolio data");

    const appScopedUrl = scopedUrl.toString();
    const now = Date.now();
    const results = await Promise.all([
      runRateLimitWorker(appScopedUrl, 8, now),
      runRateLimitWorker(appScopedUrl, 8, now),
    ]);
    assert.equal(results.reduce((sum, result) => sum + result.allowed, 0), 10);
    assert.equal(results.reduce((sum, result) => sum + result.blocked, 0), 6);

    const { createRateLimitBucketHash } = await import("../src/lib/server/auth-rate-limit.ts");
    const bucketHash = createRateLimitBucketHash(rateLimitTestSecret, "login:ip", "203.0.113.240");
    const [bucket] = await query(
      "SELECT hit_count FROM auth_rate_limit_buckets WHERE bucket_hash = $1 ORDER BY window_started_at DESC LIMIT 1",
      [bucketHash]
    );
    assert.equal(Number(bucket?.hit_count), 16);

    const expiredWindow = await Promise.all([
      runRateLimitWorker(appScopedUrl, 1, now + 15 * 60_000),
      runRateLimitWorker(appScopedUrl, 1, now + 15 * 60_000),
    ]);
    assert.equal(expiredWindow.reduce((sum, result) => sum + result.allowed, 0), 2,
      "a new fixed window permits a fresh attempt");

    process.env.NODE_ENV = "production";
    process.env.MEXO_RATE_LIMIT_HMAC_KEY = rateLimitTestSecret;
    process.env.MEXO_TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
    const httpHeaders = new Headers({ "x-real-ip": "203.0.113.241" });
    let blockedResponse = null;
    for (let attempt = 0; attempt < AUTH_RATE_LIMIT_POLICIES.login.limit + 1; attempt += 1) {
      blockedResponse = await applyAuthRateLimit(
        new Request("http://localhost/api/auth/login", { headers: httpHeaders }),
        "login"
      );
    }
    assert.equal(blockedResponse?.status, 429);
    assert.ok(Number(blockedResponse?.headers.get("Retry-After")) > 0);

    await adminPool.query(`DROP TABLE "${schema}".auth_rate_limit_buckets`);
    const databaseFailureResponse = await applyAuthRateLimit(
      new Request("http://localhost/api/auth/login", { headers: new Headers({ "x-real-ip": "203.0.113.242" }) }),
      "login"
    );
    assert.equal(databaseFailureResponse?.status, 503,
      "database failures fail closed rather than allowing an auth request");
  } finally {
    appPool = globalThis.portfelPostgresPool;
    if (appPool) await appPool.end();
    globalThis.portfelPostgresPool = undefined;
    globalThis.portfelSchemaInitialization = null;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousRateLimitSecret === undefined) delete process.env.MEXO_RATE_LIMIT_HMAC_KEY;
    else process.env.MEXO_RATE_LIMIT_HMAC_KEY = previousRateLimitSecret;
    if (previousTrustedHeader === undefined) delete process.env.MEXO_TRUSTED_CLIENT_IP_HEADER;
    else process.env.MEXO_TRUSTED_CLIENT_IP_HEADER = previousTrustedHeader;
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  }
});
