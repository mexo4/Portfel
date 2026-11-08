import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { strFromU8, unzipSync } from "fflate";
import { Pool } from "pg";

const databaseUrl = process.env.MEXO_PRIVACY_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("MEXO_PRIVACY_TEST_DATABASE_URL is required for privacy HTTP E2E.");
const parsed = new URL(databaseUrl);
assert.ok(["127.0.0.1", "::1", "localhost"].includes(parsed.hostname), "E2E requires loopback PostgreSQL");
assert.equal(decodeURIComponent(parsed.username), "mexo_privacy_test");
assert.equal(decodeURIComponent(parsed.pathname.slice(1)), "mexo_privacy_test");

const origin = "http://127.0.0.1:3100";
const ids = {
  owner: `privacy-http-${randomUUID()}`,
  other: `privacy-http-other-${randomUUID()}`,
  admin: `privacy-http-admin-${randomUUID()}`,
};
const emails = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, `${id}@example.invalid`]));
const password = "privacy-e2e-only-password";
const pool = new Pool({ connectionString: databaseUrl });
let server;

const getCookie = (response, name) => {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const cookie = values.find((value) => value.startsWith(`${name}=`));
  return cookie?.split(";", 1)[0] ?? null;
};

const jsonRequest = (path, { method = "GET", cookie, body, headers = {} } = {}) => fetch(new URL(path, origin), {
  method,
  headers: {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(cookie ? { Cookie: cookie } : {}),
    "x-real-ip": "127.0.0.1",
    ...headers,
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  cache: "no-store",
});

const waitForServer = async () => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error("Next.js E2E server exited before readiness.");
    try {
      const response = await fetch(new URL("/privacy", origin), { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Wait for the isolated local server only.
    }
    await delay(500);
  }
  throw new Error("Next.js E2E server did not become ready within 60 seconds.");
};

try {
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = "production";
  process.env.POSTGRES_CA_CERT_BASE64 = "";
  process.env.POSTGRES_CA_CERT_PATH = "";
  const { initializeDatabase, execute } = await import("../src/lib/server/db.ts");
  const { default: bcrypt } = await import("bcryptjs");
  await initializeDatabase();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 4);
  await execute(`INSERT INTO users (id,email,password_hash,display_name,email_verified_at,user_role,profile_json,portfolio_json,created_at,updated_at)
    VALUES ($1,$2,$4,'Privacy Owner',$5,'user','{"fixture":true}','{"schemaVersion":2,"portfolios":[]}',$3,$3),
           ($6,$7,$4,'Privacy Other',$5,'user','{}','{}',$3,$3),
           ($8,$9,$4,'Privacy Admin',$5,'admin','{}','{}',$3,$3)`,
  [ids.owner, emails.owner, now, passwordHash, now, ids.other, emails.other, ids.admin, emails.admin]);
  await execute(`INSERT INTO core_portfolios (id,user_id,name,base_currency,created_at,updated_at)
    VALUES ($1,$2,'Owner PLN','PLN',$4,$4),($3,$2,'Owner USD','USD',$4,$4),($5,$6,'Other USD','USD',$4,$4)`,
  [`${ids.owner}-pln`, ids.owner, `${ids.owner}-usd`, now, `${ids.other}-usd`, ids.other]);
  await execute(`INSERT INTO core_accounts (id,portfolio_id,name,kind,currency,created_at,updated_at)
    VALUES ($1,$2,'Owner PLN','CASH','PLN',$4,$4),($3,$5,'Other USD','CASH','USD',$4,$4)`,
  [`${ids.owner}-account`, `${ids.owner}-pln`, `${ids.other}-account`, now, `${ids.other}-usd`]);
  await execute(`INSERT INTO core_instruments (id,portfolio_id,type,asset_kind,symbol,name,market_currency,metadata_json,created_at,updated_at)
    VALUES ($1,$2,'STOCK','STOCK','DNP.PL','Dino Polska','PLN','{}',$3,$3)`,
  [`${ids.owner}-instrument`, `${ids.owner}-pln`, now]);
  await execute(`INSERT INTO core_operations (id,portfolio_id,account_id,asset_id,operation_type,quantity,price,currency,fee,tax,amount,date,notes,metadata_json,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'BUY',1,12.345678901234,'PLN',0,0,12.345678901234,'2026-01-02','Żółć — właściciel','{}',$5,$5),
           ($6,$7,$8,NULL,'DEPOSIT',NULL,NULL,'USD',0,0,99,'2026-01-02','other secret fixture','{}',$5,$5)`,
  [`${ids.owner}-operation`, `${ids.owner}-pln`, `${ids.owner}-account`, `${ids.owner}-instrument`, now,
    `${ids.other}-operation`, `${ids.other}-usd`, `${ids.other}-account`]);
  const appDir = process.cwd();
  const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  server = spawn(process.execPath, ["--use-system-ca", nextCli, "start", "--hostname", "127.0.0.1", "--port", "3100"], {
    cwd: appDir,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      POSTGRES_CA_CERT_BASE64: "",
      POSTGRES_CA_CERT_PATH: "",
      MEXO_PUBLIC_ORIGIN: origin,
      MEXO_RATE_LIMIT_HMAC_KEY: "isolated-e2e-only-hmac-secret-with-adequate-length",
      MEXO_TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
    },
  });
  await waitForServer();

  const draftPrivacy = await fetch(new URL("/privacy", origin));
  const draftTerms = await fetch(new URL("/terms", origin));
  assert.equal(draftPrivacy.status, 200);
  assert.match(await draftPrivacy.text(), /projekt|draft/i);
  assert.equal(draftTerms.status, 200);
  assert.match(await draftTerms.text(), /projekt|draft/i);

  const unauthorizedExport = await jsonRequest("/api/account/export");
  assert.equal(unauthorizedExport.status, 401);
  assert.equal(unauthorizedExport.headers.get("cache-control"), "private, no-store");

  const ownerLogin = await jsonRequest("/api/auth/login", { method: "POST", body: { email: emails.owner, password } });
  assert.equal(ownerLogin.status, 200);
  const ownerSession = getCookie(ownerLogin, "portfel_inwestora_session");
  assert.ok(ownerSession);
  const otherLogin = await jsonRequest("/api/auth/login", { method: "POST", body: { email: emails.other, password } });
  assert.equal(otherLogin.status, 200);
  const otherSession = getCookie(otherLogin, "portfel_inwestora_session");
  assert.ok(otherSession);

  const exportResponse = await jsonRequest("/api/account/export", { cookie: ownerSession });
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(exportResponse.headers.get("content-disposition") ?? "", /attachment; filename="mexo-export-/);
  const archive = Buffer.from(await exportResponse.arrayBuffer());
  assert.ok(archive.byteLength > 100);
  assert.equal(archive.subarray(0, 2).toString("ascii"), "PK");
  const exportFiles = Object.fromEntries(Object.entries(unzipSync(archive)).map(([name, bytes]) => [name, strFromU8(bytes)]));
  const operations = JSON.parse(exportFiles["operations.json"]);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].id, `${ids.owner}-operation`);
  assert.equal(Object.values(exportFiles).join("\n").includes("other secret fixture"), false);

  const missingOrigin = await jsonRequest("/api/account/deletion/reauth", { method: "POST", cookie: ownerSession, body: { password } });
  assert.equal(missingOrigin.status, 403);
  const wrongPassword = await jsonRequest("/api/account/deletion/reauth", {
    method: "POST", cookie: ownerSession, body: { password: "wrong" },
    headers: { origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(wrongPassword.status, 403);
  const stepUp = await jsonRequest("/api/account/deletion/reauth", {
    method: "POST", cookie: ownerSession, body: { password },
    headers: { origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(stepUp.status, 200);
  const challenge = getCookie(stepUp, "mexo_account_deletion_step_up");
  assert.ok(challenge);

  const missingChallenge = await jsonRequest("/api/account", {
    method: "DELETE", cookie: ownerSession, headers: { origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(missingChallenge.status, 403);
  const csrfAttempt = await jsonRequest("/api/account", {
    method: "DELETE", cookie: `${ownerSession}; ${challenge}`, headers: { origin: "https://attacker.invalid", "sec-fetch-site": "cross-site" },
  });
  assert.equal(csrfAttempt.status, 403);
  const cancelledStepUp = await jsonRequest("/api/account/deletion/cancel", {
    method: "POST", cookie: ownerSession, headers: { origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(cancelledStepUp.status, 200);
  const replayCancelledChallenge = await jsonRequest("/api/account", {
    method: "DELETE", cookie: `${ownerSession}; ${challenge}`, headers: { origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(replayCancelledChallenge.status, 403);
  const freshStepUp = await jsonRequest("/api/account/deletion/reauth", {
    method: "POST", cookie: ownerSession, body: { password }, headers: { origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(freshStepUp.status, 200);
  const freshChallenge = getCookie(freshStepUp, "mexo_account_deletion_step_up");
  assert.ok(freshChallenge);
  const deleted = await jsonRequest("/api/account", {
    method: "DELETE", cookie: `${ownerSession}; ${freshChallenge}`, headers: { origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { success: true });
  assert.match(getCookie(deleted, "portfel_inwestora_session") ?? "", /^portfel_inwestora_session=$/);
  const oldSession = await jsonRequest("/api/account/export", { cookie: ownerSession });
  assert.equal(oldSession.status, 401);
  const otherStillWorks = await jsonRequest("/api/account/export", { cookie: otherSession });
  assert.equal(otherStillWorks.status, 200);

  const adminLogin = await jsonRequest("/api/auth/login", { method: "POST", body: { email: emails.admin, password }, headers: { "x-real-ip": "127.0.0.2" } });
  assert.equal(adminLogin.status, 200);
  const adminSession = getCookie(adminLogin, "portfel_inwestora_session");
  assert.ok(adminSession);
  const adminStepUp = await jsonRequest("/api/account/deletion/reauth", {
    method: "POST", cookie: adminSession, body: { password }, headers: { origin, "sec-fetch-site": "same-origin", "x-real-ip": "127.0.0.2" },
  });
  assert.equal(adminStepUp.status, 200);
  const adminChallenge = getCookie(adminStepUp, "mexo_account_deletion_step_up");
  const lastAdminDeletion = await jsonRequest("/api/account", {
    method: "DELETE", cookie: `${adminSession}; ${adminChallenge}`, headers: { origin, "sec-fetch-site": "same-origin", "x-real-ip": "127.0.0.2" },
  });
  assert.equal(lastAdminDeletion.status, 409);
  const adminStillExists = await pool.query("SELECT id FROM users WHERE id = $1", [ids.admin]);
  assert.equal(adminStillExists.rowCount, 1);

  console.log("PASS privacy HTTP E2E: draft legal pages, unauthenticated/private export, login, owner-scoped ZIP, password step-up, CSRF rejection, challenge cancellation/replay prevention, deletion/session invalidation, other-user isolation, and last-admin protection.");
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(5_000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [Object.values(ids)]).catch(() => undefined);
  await pool.end();
  await globalThis.portfelPostgresPool?.end();
}
