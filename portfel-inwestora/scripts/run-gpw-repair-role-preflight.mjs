import { readFile } from "node:fs/promises";
import pg from "pg";
import { inspectRepairRole } from "./gpw-repair-role-preflight.mjs";

const blocked = (reason) => {
  console.log(JSON.stringify({ status: "BLOCKED", blockers: [reason] }, null, 2));
  process.exitCode = 2;
};

const value = process.env.MEXO_GPW_AUDIT_READONLY_DATABASE_URL;
const caBase64 = process.env.POSTGRES_CA_CERT_BASE64;
const caPath = process.env.POSTGRES_CA_CERT_PATH;
if (!value) blocked("AIVEN_READONLY_CONNECTION_UNAVAILABLE");
else if (!caBase64 && !caPath) blocked("AIVEN_CA_UNAVAILABLE");
else {
  let client;
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname.endsWith(".aivencloud.com") || url.searchParams.get("sslmode") !== "require")
      throw new Error("INVALID_AIVEN_READONLY_URI");
    const ca = caBase64 ? Buffer.from(caBase64, "base64").toString("utf8") : await readFile(caPath, "utf8");
    if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error("INVALID_AIVEN_CA");
    // node-postgres URI SSL parameters can override the explicit verified CA.
    url.searchParams.delete("sslmode");
    client = new pg.Client({ connectionString: url.toString(),
      ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000,
      application_name: "mexo-gpw-repair-role-readonly-preflight" });
    await client.connect();
    const result = await inspectRepairRole(client);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "READY") process.exitCode = 2;
  } catch (error) {
    blocked(error?.code && /^[A-Z0-9_]{3,12}$/.test(error.code) ? `PREFLIGHT_DB_ERROR:${error.code}`
      : "PREFLIGHT_CONNECTION_OR_QUERY_FAILED");
  } finally {
    await client?.end().catch(() => undefined);
  }
}
