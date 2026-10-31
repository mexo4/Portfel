import { REPAIR_ROLE, REPAIR_READ_TABLES, REPAIR_WRITE_PRIVILEGES,
  REPAIR_FORBIDDEN_PRIVILEGES } from "./gpw-repair-role-policy.mjs";

const targetTables = [...new Set([...REPAIR_READ_TABLES, ...REPAIR_WRITE_PRIVILEGES.map(([table]) => table),
  ...REPAIR_FORBIDDEN_PRIVILEGES.map(([table]) => table)])];
const commonTablePrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
/** PostgreSQL 17 introduced MAINTAIN; unknown major versions fail closed. */
export function privilegeSetForServer(serverVersionNum) {
  const version = Number(serverVersionNum);
  const major = Number.isInteger(version) ? Math.floor(version / 10000) : 0;
  return { supported: major >= 16 && major <= 18,
    privileges: major >= 17 && major <= 18
      ? [...commonTablePrivileges, "MAINTAIN"] : [...commonTablePrivileges] };
}
const approved = new Set([...REPAIR_READ_TABLES.map((table) => `${table}:SELECT`),
  ...REPAIR_WRITE_PRIVILEGES.map(([table, privilege]) => `${table}:${privilege}`)]);
const conflictModes = new Set(["RowExclusiveLock", "ShareUpdateExclusiveLock", "ShareLock",
  "ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock"]);
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

export function proposedRepairRoleSql(databaseName) {
  return [
    `CREATE ROLE ${REPAIR_ROLE} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${REPAIR_ROLE};`,
    `GRANT USAGE ON SCHEMA public TO ${REPAIR_ROLE};`,
    `GRANT SELECT ON TABLE ${REPAIR_READ_TABLES.map((table) => `public.${table}`).join(", ")} TO ${REPAIR_ROLE};`,
    ...REPAIR_WRITE_PRIVILEGES.map(([table, privilege]) =>
      `GRANT ${privilege} ON TABLE public.${table} TO ${REPAIR_ROLE};`),
  ].join("\n");
}

/** Evaluate catalog facts, never infer that an unobserved privilege is safe. */
export function evaluateRepairRolePreflight(facts) {
  const blockers = [];
  const warnings = [];
  const capabilities = privilegeSetForServer(facts.serverVersionNum);
  if (!capabilities.supported) blockers.push("UNSUPPORTED_POSTGRES_VERSION_OR_CAPABILITY");
  if (facts.readOnly !== true || facts.ssl !== true) blockers.push("READ_ONLY_OR_SSL_NOT_CONFIRMED");
  if (!facts.role) blockers.push("REPAIR_ROLE_MISSING");
  else {
    for (const flag of ["rolsuper", "rolcreatedb", "rolcreaterole", "rolbypassrls", "rolreplication"])
      if (facts.role[flag] !== false) blockers.push(`OVERPRIVILEGED_OR_UNVERIFIED_ROLE:${flag}`);
    if (facts.role.rolinherit !== false) blockers.push("REPAIR_ROLE_NOINHERIT_REQUIRED");
    if (facts.role.rolcanlogin !== true) blockers.push("REPAIR_ROLE_CANNOT_LOGIN");
    if (!Array.isArray(facts.memberships)) blockers.push("ROLE_MEMBERSHIP_NOT_VERIFIED");
    else if (facts.memberships.length) blockers.push("OVERPRIVILEGED_ROLE_MEMBERSHIP");
    if (facts.databaseConnect !== true) blockers.push("MISSING_DATABASE_CONNECT");
    if (facts.schemaUsage !== true) blockers.push("MISSING_SCHEMA_USAGE");
    if (facts.databaseCreate !== false || facts.schemaCreate !== false) blockers.push("OVERPRIVILEGED_OR_UNVERIFIED_CREATE");
    if (facts.databaseGrantOption !== false || facts.schemaGrantOption !== false)
      blockers.push("OVERPRIVILEGED_GRANT_OPTION");
  }
  const byName = new Map((facts.tables ?? []).map((table) => [table.name, table]));
  for (const name of targetTables) {
    const table = byName.get(name);
    if (!table) { blockers.push(`MISSING_TABLE:${name}`); continue; }
    if (table.rls) blockers.push(`RLS_REQUIRES_ROLE_VERIFICATION:${name}`);
  }
  if (facts.role) {
    for (const table of facts.tables ?? []) for (const privilege of capabilities.privileges) {
      const key = `${table.name}:${privilege}`;
      const granted = table.privileges?.[privilege];
      if (granted === undefined) blockers.push(`PRIVILEGE_NOT_VERIFIED:${key}`);
      else if (approved.has(key) && !granted) blockers.push(`MISSING_GRANT:${key}`);
      else if (!approved.has(key) && granted) blockers.push(`OVERPRIVILEGED_TABLE:${key}`);
      if (table.grantOptions?.[privilege] === undefined) blockers.push(`GRANT_OPTION_NOT_VERIFIED:${key}`);
      else if (table.grantOptions[privilege]) blockers.push(`OVERPRIVILEGED_GRANT_OPTION:${key}`);
    }
    for (const [table, privileges] of REPAIR_FORBIDDEN_PRIVILEGES)
      for (const privilege of privileges)
        if (byName.get(table)?.privileges?.[privilege] === true)
          blockers.push(`EXECUTOR_FORBIDDEN:${table}:${privilege}`);
  }
  for (const lock of facts.locks ?? []) {
    if (!lock.granted) warnings.push(`LOCK_WAITER:${lock.table}:${lock.mode}`);
    else if (lock.mode === "AccessExclusiveLock" ||
      (lock.table === "corporate_events" && conflictModes.has(lock.mode)) ||
      (REPAIR_WRITE_PRIVILEGES.some(([table]) => table === lock.table) &&
        ["ShareLock", "ShareRowExclusiveLock", "ExclusiveLock"].includes(lock.mode)))
      warnings.push(`LOCK_CONTENTION_NOW:${lock.table}:${lock.mode}`);
  }
  return { scope: "ROLE_PRIVILEGES_ONLY", status: blockers.length ? "BLOCKED" : "READY",
    serverVersionNum: facts.serverVersionNum ?? null,
    blockers: [...new Set(blockers)], warnings: [...new Set(warnings)],
    repairAuthorized: false,
    proposedSql: !facts.role && facts.databaseName ? proposedRepairRoleSql(facts.databaseName) : null };
}

/** All database access is enclosed by a server-enforced READ ONLY transaction. */
export async function inspectRepairRole(client, roleName = REPAIR_ROLE) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const session = (await client.query(`SELECT current_database() AS database_name,
      current_setting('server_version_num')::int AS server_version_num,
      current_setting('transaction_read_only') = 'on' AS read_only,
      (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`)).rows[0];
    const role = (await client.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls,
      rolreplication, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1`, [roleName])).rows[0] ?? null;
    const capabilities = privilegeSetForServer(session?.server_version_num);
    const memberships = role ? (await client.query(`SELECT parent.rolname FROM pg_auth_members membership
      JOIN pg_roles parent ON parent.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      WHERE member.rolname = $1`, [roleName])).rows : [];
    const catalogSql = role ? `SELECT c.relname AS name, c.relrowsecurity AS rls,
      jsonb_object_agg(perm.name, has_table_privilege($1, c.oid, perm.name)) AS privileges,
      jsonb_object_agg(perm.name,
        has_table_privilege($1, c.oid, perm.name || ' WITH GRANT OPTION')) AS grant_options
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest($2::text[]) AS perm(name)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      GROUP BY c.oid, c.relname, c.relrowsecurity`
      : `SELECT c.relname AS name, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`;
    const catalog = (await client.query(catalogSql,
      role ? [roleName, capabilities.privileges] : [])).rows;
    let databaseConnect = false;
    let databaseCreate = false;
    let schemaUsage = false;
    let schemaCreate = false;
    let databaseGrantOption = false;
    let schemaGrantOption = false;
    const tables = [];
    if (role) {
      const access = (await client.query(`SELECT
        has_database_privilege($1, current_database(), 'CONNECT') AS database_connect,
        has_database_privilege($1, current_database(), 'CREATE') AS database_create,
        has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
        has_schema_privilege($1, 'public', 'CREATE') AS schema_create,
        has_database_privilege($1, current_database(), 'CONNECT WITH GRANT OPTION')
          OR has_database_privilege($1, current_database(), 'CREATE WITH GRANT OPTION') AS database_grant_option,
        has_schema_privilege($1, 'public', 'USAGE WITH GRANT OPTION')
          OR has_schema_privilege($1, 'public', 'CREATE WITH GRANT OPTION') AS schema_grant_option`,
      [roleName])).rows[0];
      ({ database_connect: databaseConnect, database_create: databaseCreate,
        schema_usage: schemaUsage, schema_create: schemaCreate,
        database_grant_option: databaseGrantOption, schema_grant_option: schemaGrantOption } = access);
      tables.push(...catalog.map((row) => ({ name: row.name, rls: row.rls,
        privileges: row.privileges, grantOptions: row.grant_options })));
    } else tables.push(...catalog.map((row) => ({ name: row.name, rls: row.rls })));
    const locks = (await client.query(`SELECT c.relname AS table, locks.mode, locks.granted
      FROM pg_locks locks JOIN pg_class c ON c.oid = locks.relation
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        AND locks.pid <> pg_backend_pid()`, [targetTables])).rows;
    const result = evaluateRepairRolePreflight({ role, memberships,
      serverVersionNum: session?.server_version_num, readOnly: session?.read_only,
      ssl: session?.ssl, databaseName: session?.database_name, databaseConnect,
      databaseCreate, schemaUsage, schemaCreate, databaseGrantOption, schemaGrantOption, tables, locks });
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
