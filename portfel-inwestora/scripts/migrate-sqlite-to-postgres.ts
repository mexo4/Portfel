const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { loadEnvConfig } = require("@next/env");
const { Pool } = require("pg");

type TableDefinition = {
  name: string;
  columns: string[];
  conflictColumn: string;
};

type CountReport = Record<string, { sqlite: number; postgres: number }>;

const appRoot = path.resolve(__dirname, "..");
const sqlitePath = path.join(appRoot, ".data", "portfel-inwestora.db");

loadEnvConfig(appRoot);

const tableDefinitions: TableDefinition[] = [
  {
    name: "users",
    conflictColumn: "id",
    columns: [
      "id",
      "email",
      "password_hash",
      "display_name",
      "email_verified_at",
      "subscription_plan",
      "subscription_status",
      "subscription_updated_at",
      "profile_json",
      "portfolio_json",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "sessions",
    conflictColumn: "id",
    columns: ["id", "user_id", "token_hash", "created_at", "expires_at"],
  },
  {
    name: "email_verification_tokens",
    conflictColumn: "id",
    columns: ["id", "user_id", "token_hash", "created_at", "expires_at"],
  },
  {
    name: "password_reset_tokens",
    conflictColumn: "id",
    columns: ["id", "user_id", "token_hash", "created_at", "expires_at"],
  },
  {
    name: "market_cache",
    conflictColumn: "key",
    columns: ["key", "payload_json", "updated_at"],
  },
];

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`;

const getDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL for PostgreSQL/Neon.");
  }

  return databaseUrl;
};

const getPool = () => {
  const databaseUrl = new URL(getDatabaseUrl());
  const sslMode = databaseUrl.searchParams.get("sslmode");
  databaseUrl.searchParams.delete("sslmode");

  return new Pool({
    connectionString: databaseUrl.toString(),
    ssl: sslMode === "disable" ? undefined : { rejectUnauthorized: true },
  });
};

const assertSqliteDatabaseExists = () => {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}`);
  }
};

const getSqliteTableNames = (sqliteDb: InstanceType<typeof DatabaseSync>) =>
  new Set(
    sqliteDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .all()
      .map((row: { name: string }) => row.name)
  );

const assertSqliteTablesExist = (sqliteDb: InstanceType<typeof DatabaseSync>) => {
  const sqliteTables = getSqliteTableNames(sqliteDb);
  const missingTables = tableDefinitions
    .map((table) => table.name)
    .filter((tableName) => !sqliteTables.has(tableName));

  if (missingTables.length > 0) {
    throw new Error(`Missing SQLite tables: ${missingTables.join(", ")}`);
  }
};

const assertPostgresTablesExist = async (
  client: InstanceType<typeof Pool>["Client"]
) => {
  const expectedTableNames = tableDefinitions.map((table) => table.name);
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [expectedTableNames]
  );
  const postgresTables = new Set(
    result.rows.map((row: { table_name: string }) => row.table_name)
  );
  const missingTables = expectedTableNames.filter(
    (tableName) => !postgresTables.has(tableName)
  );

  if (missingTables.length > 0) {
    throw new Error(`Missing PostgreSQL tables: ${missingTables.join(", ")}`);
  }
};

const assertNoUserEmailConflicts = async (
  sqliteDb: InstanceType<typeof DatabaseSync>,
  client: InstanceType<typeof Pool>["Client"]
) => {
  const sqliteUsers = sqliteDb
    .prepare("SELECT id, email FROM users")
    .all() as Array<{ id: string; email: string }>;

  if (sqliteUsers.length === 0) return;

  const emails = sqliteUsers.map((user) => user.email);
  const result = await client.query(
    "SELECT id, email FROM users WHERE email = ANY($1::text[])",
    [emails]
  );
  const postgresUsersByEmail = new Map(
    result.rows.map((row: { id: string; email: string }) => [row.email, row.id])
  );
  const conflicts = sqliteUsers.filter((user) => {
    const postgresId = postgresUsersByEmail.get(user.email);
    return postgresId && postgresId !== user.id;
  });

  if (conflicts.length > 0) {
    throw new Error(
      `User email conflicts with different IDs: ${conflicts
        .map((user) => user.email)
        .join(", ")}`
    );
  }
};

const readSqliteRows = (
  sqliteDb: InstanceType<typeof DatabaseSync>,
  table: TableDefinition
) => {
  const columns = table.columns.map(quoteIdentifier).join(", ");
  return sqliteDb
    .prepare(`SELECT ${columns} FROM ${quoteIdentifier(table.name)}`)
    .all() as Array<Record<string, string | null>>;
};

const buildUpsertStatement = (table: TableDefinition) => {
  const columns = table.columns.map(quoteIdentifier).join(", ");
  const values = table.columns.map((_, index) => `$${index + 1}`).join(", ");
  const conflictColumn = quoteIdentifier(table.conflictColumn);
  const updateColumns = table.columns.filter(
    (column) => column !== table.conflictColumn
  );
  const updates = updateColumns
    .map((column) => {
      const quotedColumn = quoteIdentifier(column);
      return `${quotedColumn} = EXCLUDED.${quotedColumn}`;
    })
    .join(", ");

  return `
    INSERT INTO ${quoteIdentifier(table.name)} (${columns})
    VALUES (${values})
    ON CONFLICT (${conflictColumn})
    DO UPDATE SET ${updates}
  `;
};

const importTable = async (
  sqliteDb: InstanceType<typeof DatabaseSync>,
  client: InstanceType<typeof Pool>["Client"],
  table: TableDefinition
) => {
  const rows = readSqliteRows(sqliteDb, table);
  const statement = buildUpsertStatement(table);

  for (const row of rows) {
    await client.query(
      statement,
      table.columns.map((column) => row[column] ?? null)
    );
  }

  console.log(`Imported ${rows.length} rows into ${table.name}.`);
};

const getCounts = async (
  sqliteDb: InstanceType<typeof DatabaseSync>,
  client: InstanceType<typeof Pool>["Client"]
) => {
  const counts: CountReport = {};

  for (const table of tableDefinitions) {
    const sqliteCount = sqliteDb
      .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`)
      .get() as { count: number };
    const postgresCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(table.name)}`
    );

    counts[table.name] = {
      sqlite: sqliteCount.count,
      postgres: postgresCount.rows[0].count,
    };
  }

  return counts;
};

const assertCountsMatch = (counts: CountReport) => {
  const mismatches = Object.entries(counts).filter(
    ([, count]) => count.sqlite !== count.postgres
  );

  if (mismatches.length > 0) {
    throw new Error(
      `SQLite/PostgreSQL count mismatch: ${mismatches
        .map(
          ([tableName, count]) =>
            `${tableName} sqlite=${count.sqlite} postgres=${count.postgres}`
        )
        .join("; ")}`
    );
  }
};

const main = async () => {
  assertSqliteDatabaseExists();

  const sqliteDb = new DatabaseSync(sqlitePath, { readOnly: true });
  const pool = getPool();
  const client = await pool.connect();

  try {
    assertSqliteTablesExist(sqliteDb);

    await client.query("BEGIN");
    await assertPostgresTablesExist(client);
    await assertNoUserEmailConflicts(sqliteDb, client);

    for (const table of tableDefinitions) {
      await importTable(sqliteDb, client, table);
    }

    const counts = await getCounts(sqliteDb, client);
    assertCountsMatch(counts);

    await client.query("COMMIT");

    console.log("Migration finished successfully.");
    console.table(counts);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqliteDb.close();
  }
};

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
