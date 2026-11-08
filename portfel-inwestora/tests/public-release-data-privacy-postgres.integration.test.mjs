import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";

const databaseUrl = process.env.MEXO_PRIVACY_TEST_DATABASE_URL;

test("privacy export and account deletion use isolated PostgreSQL with owned-data cascades", {
  skip: !databaseUrl,
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(parsed.hostname), "privacy integration tests only accept loopback PostgreSQL");
  assert.equal(decodeURIComponent(parsed.username), "mexo_privacy_test");
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), "mexo_privacy_test");

  const schema = `privacy_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    ca: process.env.POSTGRES_CA_CERT_BASE64,
    caPath: process.env.POSTGRES_CA_CERT_PATH,
  };
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.NODE_ENV = "test";
  process.env.POSTGRES_CA_CERT_BASE64 = "";
  process.env.POSTGRES_CA_CERT_PATH = "";
  await globalThis.portfelPostgresPool?.end();
  globalThis.portfelPostgresPool = undefined;
  globalThis.portfelSchemaInitialization = null;

  try {
    const { initializeDatabase, query, execute } = await import("../src/lib/server/db.ts");
    const { createAccountDataExport, deleteAccountAfterReauthentication, issueAccountDeletionChallenge, verifyAccountPasswordForStepUp } = await import("../src/lib/server/account-privacy.ts");
    const { enforceDistributedRateLimit } = await import("../src/lib/server/auth-rate-limit.ts");
    const { default: bcrypt } = await import("bcryptjs");
    await initializeDatabase();
    await initializeDatabase();

    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash("correct-test-password", 4);
    await execute(`INSERT INTO users (id,email,password_hash,display_name,user_role,profile_json,portfolio_json,created_at,updated_at)
      VALUES ('privacy-user','privacy-user@example.invalid',$2,'Żaneta Inwestor','user',
        '{"country":"Polska","investmentGoal":"Długoterminowy"}',
        '{"schemaVersion":2,"portfolios":[{"id":"p-main","name":"Portfel Łączny","assets":[{"id":"legacy-auto","symbol":"DNP.PL","quantity":2,"latestPrice":123.456,"priceSource":"AUTOMATIC"},{"id":"legacy-manual","symbol":"CUSTOM","quantity":1,"latestPrice":4.25,"priceSource":"MANUAL"}]}]}',$1,$1),
        ('privacy-other','other-private@example.invalid','OTHER-HASH','Other','user','{}','{}',$1,$1),
        ('privacy-empty','empty@example.invalid',NULL,'Empty','user','{}','{}',$1,$1),
        ('privacy-admin','admin@example.invalid','ADMIN-HASH','Admin','admin','{}','{}',$1,$1),
        ('privacy-admin-2','admin-2@example.invalid','ADMIN-HASH-2','Admin Two','admin','{}','{}',$1,$1)`, [now, passwordHash]);
    await execute(`INSERT INTO core_portfolios (id,user_id,name,account_type,account_config_json,base_currency,metadata_json,created_at,updated_at)
      VALUES ('p-main','privacy-user','Portfel Łączny','STANDARD','{}','PLN','{}',$1,$1),
             ('p-usd','privacy-user','Portfel USD','STANDARD','{}','USD','{}',$1,$1),
             ('p-other','privacy-other','Other portfolio','STANDARD','{}','USD','{}',$1,$1)`, [now]);
    await execute(`INSERT INTO core_accounts (id,portfolio_id,name,kind,currency,metadata_json,created_at,updated_at)
      VALUES ('a-main','p-main','Konto PLN','CASH','PLN','{}',$1,$1),('a-usd','p-usd','Konto USD','CASH','USD','{}',$1,$1),('a-other','p-other','USD','CASH','USD','{}',$1,$1)`, [now]);
    await execute(`INSERT INTO core_instruments (id,portfolio_id,type,asset_kind,symbol,name,market_currency,provider,provider_id,isin,metadata_json,created_at,updated_at)
      VALUES ('i-main','p-main','STOCK','STOCK','DNP.PL','Dino Polska','PLN','manual',NULL,NULL,'{}',$1,$1),
             ('i-usd','p-usd','ETF','ETF','VWRD.UK','Vanguard FTSE All-World','USD','manual',NULL,'IE00BK5BQT80','{}',$1,$1)`, [now]);
    await execute(`INSERT INTO core_operations (id,portfolio_id,account_id,asset_id,operation_type,quantity,price,currency,fee,tax,amount,date,notes,metadata_json,created_at,updated_at)
      VALUES ('op-main','p-main','a-main','i-main','BUY',2,100.125,'PLN',1.25,0,201.5,'2026-01-02','Kupno, Żaneta','{"source":"test"}',$1,$1),
             ('op-dividend','p-usd','a-usd','i-usd','DIVIDEND',NULL,NULL,'USD',0,0,0.123456789012,'2026-02-03','=Formula must be escaped','{}',$1,$1),
             ('op-transfer','p-usd','a-usd',NULL,'TRANSFER',NULL,NULL,'USD',0,0,-4.56789123,'2026-02-04','Transfer wewnętrzny','{}',$1,$1)`, [now]);
    await execute(`INSERT INTO auth_accounts (id,user_id,provider,provider_account_id,created_at,updated_at)
      VALUES ('auth-main','privacy-user','google','google-subject-fixture',$1,$1)`, [now]);
    await execute(`INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at)
      VALUES ('session-main','privacy-user','session-hash-secret',$1,$1)`, [now]);
    await execute(`INSERT INTO user_dashboard_layouts (user_id,layout_json,updated_at) VALUES ('privacy-user','{"widgets":["summary"]}',$1)`, [now]);
    await execute(`INSERT INTO user_watchlist_items (id,user_id,canonical_key,symbol,name,market_currency,created_at,updated_at)
      VALUES ('w-main','privacy-user','DNP.PL','DNP.PL','Dino Polska','PLN',$1,$1)`, [now]);
    await execute(`INSERT INTO user_calendar_subscriptions (id,user_id,name,scope_mode,categories_json,portfolio_ids_json,manual_tickers_json,access_token,token_hash,created_at,updated_at)
      VALUES ('c-main','privacy-user','Mój feed','MANUAL','[]','[]','[]','RAW-CALENDAR-SECRET','HASH-CALENDAR-SECRET',$1,$1)`, [now]);
    await execute(`INSERT INTO portfolio_asset_quotes (portfolio_id,asset_id,payload_json,quote_timestamp,updated_at)
      VALUES ('p-main','i-main','{"portfolioId":"p-main","assetId":"i-main","latestPrice":123.456,"marketCurrency":"PLN","priceSource":"MANUAL","provider":"market-vendor","automaticFallback":{"latestPrice":120}}',$1,$1)`, [now]);
    await execute(`INSERT INTO portfolio_engine_cache (key,portfolio_id,payload_json,updated_at) VALUES ('cache-main','p-main','{}',$1)`, [now]);
    await execute(`INSERT INTO market_cache (key,payload_json,updated_at) VALUES ('shared-fixture','{"kept":true}',$1)`, [now]);

    const archive = await createAccountDataExport("privacy-user");
    assert.ok(archive instanceof Uint8Array);
    const archiveEntries = unzipSync(archive);
    const files = Object.fromEntries(Object.entries(archiveEntries).map(([name, bytes]) => [name, strFromU8(bytes)]));
    const operations = JSON.parse(files["operations.json"]);
    const portfolioJson = JSON.parse(files["portfolios.json"]);
    const calendar = JSON.parse(files["calendar-subscriptions.json"]);
    const manualPrices = JSON.parse(files["manual-prices.json"]);
    const manifest = JSON.parse(files["manifest.json"]);
    const authProviders = JSON.parse(files["authentication.json"]);
    const legacyBook = JSON.parse(files["legacy-portfolio.json"]);
    assert.equal(operations.length, 3);
    assert.equal(operations[0].quantity, 2);
    assert.equal(operations[0].price, 100.125);
    assert.deepEqual(portfolioJson.map((row) => row.id), ["p-main", "p-usd"]);
    assert.equal(calendar[0].name, "Mój feed");
    assert.equal("access_token" in calendar[0], false);
    assert.equal("token_hash" in calendar[0], false);
    assert.equal(manualPrices[0].latestPrice, 123.456);
    assert.equal("automaticFallback" in manualPrices[0], false);
    assert.match(files["operations.csv"], /Kupno, Żaneta/);
    assert.match(files["dividends.csv"], /op-dividend/);
    assert.match(files["cashflows.csv"], /op-transfer/);
    assert.match(files["README.txt"], /oryginalne/);
    assert.equal(manifest.exportId.length > 20, true);
    assert.equal(manifest.files.find((entry) => entry.path === "operations.json").records, 3);
    assert.equal(manifest.files.find((entry) => entry.path === "operations.json").bytes > 0, true);
    for (const entry of manifest.files) {
      assert.equal(entry.bytes, archiveEntries[entry.path].byteLength, `manifest byte count for ${entry.path}`);
    }
    assert.equal(legacyBook.portfolios[0].assets[0].latestPrice, undefined);
    assert.equal(legacyBook.portfolios[0].assets[0].quantity, 2);
    assert.equal(legacyBook.portfolios[0].assets[1].latestPrice, 4.25);
    assert.deepEqual(authProviders, [{ provider: "google", providerAccountId: "google-subject-fixture", linkedAt: now }]);
    const wholeArchive = Object.values(files).join("\n");
    assert.equal(wholeArchive.includes(passwordHash), false);
    assert.equal(wholeArchive.includes("session-hash-secret"), false);
    assert.equal(wholeArchive.includes("RAW-CALENDAR-SECRET"), false);
    assert.equal(wholeArchive.includes("HASH-CALENDAR-SECRET"), false);
    assert.equal(wholeArchive.includes("other-private@example.invalid"), false);
    const emptyExport = await createAccountDataExport("privacy-empty");
    const emptyFiles = Object.fromEntries(Object.entries(unzipSync(emptyExport)).map(([name, bytes]) => [name, strFromU8(bytes)]));
    assert.deepEqual(JSON.parse(emptyFiles["portfolios.json"]), []);
    assert.deepEqual(JSON.parse(emptyFiles["operations.json"]), []);
    assert.equal(await verifyAccountPasswordForStepUp("privacy-user", "correct-test-password"), true);
    assert.equal(await verifyAccountPasswordForStepUp("privacy-user", "wrong-password"), false);

    const limiterHeaders = new Headers({ "x-real-ip": "127.0.0.1" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await enforceDistributedRateLimit(limiterHeaders, "accountExport", "privacy-user", {
        secret: "isolated-test-hmac-secret-12345678901234567890",
        isProduction: false,
        now: Date.now() + attempt,
      });
      assert.equal(result.allowed, true);
    }
    const limited = await enforceDistributedRateLimit(limiterHeaders, "accountExport", "privacy-user", {
      secret: "isolated-test-hmac-secret-12345678901234567890", isProduction: false,
    });
    assert.equal(limited.allowed, false);
    const concurrentIdentity = `parallel-${randomUUID()}`;
    const concurrentLimitResults = await Promise.all(Array.from({ length: 8 }, () => enforceDistributedRateLimit(
      limiterHeaders,
      "accountExport",
      concurrentIdentity,
      { secret: "isolated-test-hmac-secret-12345678901234567890", isProduction: false },
    )));
    assert.equal(concurrentLimitResults.filter((result) => result.allowed).length, 2);
    assert.equal(concurrentLimitResults.filter((result) => !result.allowed).length, 6);
    await assert.rejects(enforceDistributedRateLimit(limiterHeaders, "accountExport", "fail-closed", {
      secret: "", isProduction: true,
    }), /not configured/);

    await execute(`INSERT INTO core_operations (id,portfolio_id,account_id,operation_type,currency,amount,date,created_at,updated_at)
      SELECT 'privacy-bulk-' || sequence, 'p-main', 'a-main', 'FEE', 'PLN', 0.1, '2026-03-01', $1, $1
      FROM generate_series(1, 50001) AS sequence`, [now]);
    const { AccountExportTooLargeError } = await import("../src/lib/server/account-privacy.ts");
    await assert.rejects(createAccountDataExport("privacy-user"), AccountExportTooLargeError);

    const expiredChallenge = await issueAccountDeletionChallenge("privacy-user");
    await execute("UPDATE account_deletion_challenges SET expires_at = $1 WHERE user_id = $2", [new Date(Date.now() - 1000).toISOString(), "privacy-user"]);
    await assert.rejects(deleteAccountAfterReauthentication("privacy-user", expiredChallenge.token), /Potwierdzenie/);
    assert.equal((await query("SELECT id FROM users WHERE id='privacy-user'")).length, 1);
    const challenge = await issueAccountDeletionChallenge("privacy-user");
    await assert.rejects(deleteAccountAfterReauthentication("privacy-user", "wrong-token"), /Potwierdzenie/);
    assert.equal((await query("SELECT id FROM users WHERE id='privacy-user'")).length, 1);
    await deleteAccountAfterReauthentication("privacy-user", challenge.token);
    assert.equal((await query("SELECT id FROM users WHERE id='privacy-user'")).length, 0);
    assert.equal((await query("SELECT id FROM core_portfolios WHERE id='p-main'")).length, 0);
    assert.equal((await query("SELECT id FROM core_operations WHERE id='op-main'")).length, 0);
    assert.equal((await query("SELECT key FROM portfolio_engine_cache WHERE key='cache-main'")).length, 0);
    assert.equal((await query("SELECT id FROM sessions WHERE id='session-main'")).length, 0);
    assert.equal((await query("SELECT key FROM market_cache WHERE key='shared-fixture'")).length, 1);
    assert.equal((await query("SELECT id FROM users WHERE id='privacy-other'")).length, 1);
    await assert.rejects(deleteAccountAfterReauthentication("privacy-user", challenge.token), /Konto/);

    const adminChallenge1 = await issueAccountDeletionChallenge("privacy-admin");
    const adminChallenge2 = await issueAccountDeletionChallenge("privacy-admin-2");
    const concurrentAdminDeletes = await Promise.allSettled([
      deleteAccountAfterReauthentication("privacy-admin", adminChallenge1.token),
      deleteAccountAfterReauthentication("privacy-admin-2", adminChallenge2.token),
    ]);
    assert.equal(concurrentAdminDeletes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentAdminDeletes.filter((result) => result.status === "rejected" && /administrator/.test(String(result.reason))).length, 1);
    const remainingAdmins = await query("SELECT id FROM users WHERE user_role='admin'");
    assert.equal(remainingAdmins.length, 1);
    const lastAdminChallenge = await issueAccountDeletionChallenge(remainingAdmins[0].id);
    await assert.rejects(deleteAccountAfterReauthentication(remainingAdmins[0].id, lastAdminChallenge.token), /administrator/);
    assert.equal((await query("SELECT user_id FROM account_deletion_challenges WHERE user_id = $1", [remainingAdmins[0].id])).length, 0);
    await assert.rejects(deleteAccountAfterReauthentication(remainingAdmins[0].id, lastAdminChallenge.token), /Potwierdzenie/);
  } finally {
    await globalThis.portfelPostgresPool?.end();
    globalThis.portfelPostgresPool = undefined;
    globalThis.portfelSchemaInitialization = null;
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
    if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.databaseUrl;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.ca === undefined) delete process.env.POSTGRES_CA_CERT_BASE64; else process.env.POSTGRES_CA_CERT_BASE64 = previous.ca;
    if (previous.caPath === undefined) delete process.env.POSTGRES_CA_CERT_PATH; else process.env.POSTGRES_CA_CERT_PATH = previous.caPath;
  }
});
