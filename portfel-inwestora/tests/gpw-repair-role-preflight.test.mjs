import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRepairRolePreflight, inspectRepairRole,
  proposedRepairRoleSql } from "../scripts/gpw-repair-role-preflight.mjs";
import { REPAIR_READ_TABLES, REPAIR_WRITE_PRIVILEGES,
  REPAIR_FORBIDDEN_PRIVILEGES } from "../scripts/gpw-repair-role-policy.mjs";

const allNames = [...new Set([...REPAIR_READ_TABLES, ...REPAIR_WRITE_PRIVILEGES.map(([name]) => name),
  ...REPAIR_FORBIDDEN_PRIVILEGES.map(([name]) => name)])];
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const goodFacts = () => ({ role: { rolsuper: false, rolcreatedb: false, rolcreaterole: false,
  rolbypassrls: false, rolreplication: false, rolcanlogin: true }, readOnly: true, ssl: true,
  databaseName: "defaultdb", databaseConnect: true, schemaUsage: true,
  databaseCreate: false, schemaCreate: false, memberships: [], locks: [],
  tables: allNames.map((name) => ({ name, rls: false, privileges: Object.fromEntries(privileges.map((item) =>
    [item, (item === "SELECT" && REPAIR_READ_TABLES.includes(name)) ||
      REPAIR_WRITE_PRIVILEGES.some(([table, privilege]) => table === name && privilege === item)])) })) });

test("exact scoped executor rights are ready; no SQL is emitted", () => {
  const result = evaluateRepairRolePreflight(goodFacts());
  assert.equal(result.status, "READY");
  assert.equal(result.proposedSql, null);
});

test("missing role emits an operator-only SQL plan without credentials", () => {
  const facts = goodFacts();
  facts.role = null;
  const result = evaluateRepairRolePreflight(facts);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("REPAIR_ROLE_MISSING"));
  assert.match(result.proposedSql, /CREATE ROLE mexo_gpw_repair LOGIN NOINHERIT/);
  assert.match(result.proposedSql, /GRANT UPDATE ON TABLE public.corporate_events/);
  assert.doesNotMatch(result.proposedSql, /PASSWORD|DELETE ON TABLE|TRUNCATE ON TABLE/);
  assert.equal(proposedRepairRoleSql('db"x').includes('"db""x"'), true);
});

test("missing and excess rights, RLS and current lock contention are detected", () => {
  const facts = goodFacts();
  facts.tables.find((row) => row.name === "corporate_events").privileges.UPDATE = false;
  facts.tables.find((row) => row.name === "users").privileges.SELECT = true;
  facts.tables.find((row) => row.name === "espi_reports").rls = true;
  facts.schemaCreate = true;
  facts.memberships = [{ rolname: "application_owner" }];
  facts.locks = [{ table: "corporate_events", mode: "RowExclusiveLock", granted: true }];
  const result = evaluateRepairRolePreflight(facts);
  assert.equal(result.status, "BLOCKED");
  for (const item of ["MISSING_GRANT:corporate_events:UPDATE", "OVERPRIVILEGED_TABLE:users:SELECT",
    "RLS_REQUIRES_ROLE_VERIFICATION:espi_reports", "OVERPRIVILEGED_CREATE",
    "OVERPRIVILEGED_ROLE_MEMBERSHIP"])
    assert.ok(result.blockers.includes(item));
  assert.ok(result.warnings.includes("LOCK_CONTENTION_NOW:corporate_events:RowExclusiveLock"));
});

test("missing table, forbidden DELETE and missing TLS cannot be called ready", () => {
  const facts = goodFacts();
  facts.tables = facts.tables.filter((row) => row.name !== "espi_sync_state");
  facts.tables.find((row) => row.name === "corporate_events").privileges.DELETE = true;
  facts.ssl = false;
  const result = evaluateRepairRolePreflight(facts);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("MISSING_TABLE:espi_sync_state"));
  assert.ok(result.blockers.includes("EXECUTOR_FORBIDDEN:corporate_events:DELETE"));
  assert.ok(result.blockers.includes("READ_ONLY_OR_SSL_NOT_CONFIRMED"));
});

test("catalog inspection stays in a read-only transaction and never acquires a lock", async () => {
  const statements = [];
  const client = { query: async (sql) => {
    statements.push(sql);
    if (sql.includes("current_database() AS database_name"))
      return { rows: [{ database_name: "defaultdb", read_only: true, ssl: true }] };
    if (sql.includes("FROM pg_roles WHERE rolname")) return { rows: [] };
    if (sql.includes("FROM pg_class c")) return { rows: allNames.map((name) => ({ name, rls: false })) };
    return { rows: [] };
  } };
  const result = await inspectRepairRole(client);
  assert.equal(result.status, "BLOCKED");
  assert.match(statements[0], /READ ONLY/);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.some((sql) => /^(INSERT|UPDATE|DELETE|GRANT|CREATE ROLE|LOCK TABLE)|pg_try_advisory/i.test(sql.trim())), false);
});

test("isolated PostgreSQL accepts the read-only catalog preflight",
  { skip: !process.env.MEXO_GPW_TEST_DATABASE_URL }, async () => {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: process.env.MEXO_GPW_TEST_DATABASE_URL });
    try {
      await client.connect();
      const result = await inspectRepairRole(client);
      assert.equal(result.scope, "ROLE_PRIVILEGES_ONLY");
      assert.equal(result.repairAuthorized, false);
      assert.equal(result.status, "BLOCKED");
      assert.equal((await client.query("SELECT current_setting('transaction_read_only') AS mode")).rows[0].mode, "off");
    } finally {
      await client.end().catch(() => undefined);
    }
  });
