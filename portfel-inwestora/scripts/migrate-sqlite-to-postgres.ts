/* eslint-disable @typescript-eslint/no-require-imports */
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

type PortfolioMergeReport = {
  addedAssets: number;
  addedSales: number;
  addedAdjustments: number;
  addedPortfolios: number;
};

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parseJson = (value: string | null | undefined) => {
  try {
    return JSON.parse(value ?? "{}") as unknown;
  } catch {
    return {};
  }
};

const getArray = (value: unknown) => (Array.isArray(value) ? value : []);

const getEntityId = (value: unknown) => {
  const record = asRecord(value);
  return typeof record.id === "string" ? record.id : "";
};

const mergeEntityArray = (
  target: unknown,
  source: unknown,
  getIdentity: (value: Record<string, unknown>) => string
) => {
  const targetItems = getArray(target);
  const knownIds = new Set(targetItems.map(getEntityId).filter(Boolean));
  const knownIdentities = new Set(
    targetItems.map((item) => getIdentity(asRecord(item))).filter(Boolean)
  );
  const added = getArray(source).filter((item) => {
    const record = asRecord(item);
    const id = getEntityId(record);
    const identity = getIdentity(record);

    if ((id && knownIds.has(id)) || (identity && knownIdentities.has(identity))) {
      return false;
    }

    if (id) knownIds.add(id);
    if (identity) knownIdentities.add(identity);
    return true;
  });

  return {
    items: [...targetItems, ...added],
    added: added.length,
  };
};

const getAssetIdentity = (value: Record<string, unknown>) =>
  [
    value.kind,
    value.symbol,
    value.purchaseDate,
    value.quantity,
    value.purchasePrice,
    value.purchaseCurrency,
    value.marketCurrency,
  ]
    .map((part) => String(part ?? ""))
    .join("|");

const getSaleIdentity = (value: Record<string, unknown>) =>
  [value.assetKey, value.saleDate, value.quantity, value.salePrice]
    .map((part) => String(part ?? ""))
    .join("|");

const getAdjustmentIdentity = (value: Record<string, unknown>) =>
  [value.date, value.amount, value.currency, value.note]
    .map((part) => String(part ?? ""))
    .join("|");

const mergePortfolioState = (
  targetValue: unknown,
  sourceValue: unknown,
  report: PortfolioMergeReport
) => {
  const target = asRecord(targetValue);
  const source = asRecord(sourceValue);
  const assets = mergeEntityArray(target.assets, source.assets, getAssetIdentity);
  const sales = mergeEntityArray(target.sales, source.sales, getSaleIdentity);
  const realizedAdjustments = mergeEntityArray(
    target.realizedAdjustments,
    source.realizedAdjustments,
    getAdjustmentIdentity
  );

  report.addedAssets += assets.added;
  report.addedSales += sales.added;
  report.addedAdjustments += realizedAdjustments.added;

  return {
    ...source,
    ...target,
    assets: assets.items,
    sales: sales.items,
    realizedAdjustments: realizedAdjustments.items,
  };
};

const isPortfolioBook = (value: unknown) => Array.isArray(asRecord(value).portfolios);

const getActivePortfolioId = (book: Record<string, unknown>) =>
  typeof book.activePortfolioId === "string" ? book.activePortfolioId : "";

const mergePortfolioJson = (sourceJson: string, targetJson: string | null) => {
  const source = parseJson(sourceJson);
  const target = parseJson(targetJson);
  const report: PortfolioMergeReport = {
    addedAssets: 0,
    addedSales: 0,
    addedAdjustments: 0,
    addedPortfolios: 0,
  };

  if (!isPortfolioBook(source) && !isPortfolioBook(target)) {
    return {
      portfolioJson: JSON.stringify(mergePortfolioState(target, source, report)),
      report,
    };
  }

  const sourceBook = asRecord(source);
  const targetBook = asRecord(target);
  const primaryBook = isPortfolioBook(target) ? targetBook : sourceBook;
  const secondaryBook = isPortfolioBook(target) ? sourceBook : targetBook;
  const primaryPortfolios = getArray(primaryBook.portfolios);
  const secondaryPortfolios = getArray(secondaryBook.portfolios);
  const secondaryById = new Map(
    secondaryPortfolios
      .map((portfolio) => [getEntityId(portfolio), portfolio] as const)
      .filter(([id]) => Boolean(id))
  );
  const activePortfolioId =
    getActivePortfolioId(primaryBook) || getActivePortfolioId(secondaryBook) || getEntityId(primaryPortfolios[0]);
  const sourceLegacyState = isPortfolioBook(source) ? null : source;
  const targetLegacyState = isPortfolioBook(target) ? null : target;
  const canMatchSinglePortfolio =
    primaryPortfolios.length === 1 && secondaryPortfolios.length === 1;
  let legacyMerged = false;

  const mergedPortfolios = primaryPortfolios.map((portfolio) => {
    const id = getEntityId(portfolio);
    const matchingPortfolio =
      (id ? secondaryById.get(id) : undefined) ??
      (canMatchSinglePortfolio ? secondaryPortfolios[0] : undefined);

    if (matchingPortfolio) {
      secondaryById.delete(getEntityId(matchingPortfolio));
      return mergePortfolioState(portfolio, matchingPortfolio, report);
    }

    if (!legacyMerged && id === activePortfolioId && (sourceLegacyState || targetLegacyState)) {
      legacyMerged = true;
      return mergePortfolioState(portfolio, sourceLegacyState ?? targetLegacyState, report);
    }

    return portfolio;
  });

  for (const portfolio of secondaryById.values()) {
    mergedPortfolios.push(portfolio);
    report.addedPortfolios += 1;
  }

  if (!legacyMerged && (sourceLegacyState || targetLegacyState) && mergedPortfolios.length > 0) {
    mergedPortfolios[0] = mergePortfolioState(
      mergedPortfolios[0],
      sourceLegacyState ?? targetLegacyState,
      report
    );
  }

  return {
    portfolioJson: JSON.stringify({
      ...secondaryBook,
      ...primaryBook,
      portfolios: mergedPortfolios,
      activePortfolioId,
    }),
    report,
  };
};

const getDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL for PostgreSQL.");
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

const importUsers = async (
  sqliteDb: InstanceType<typeof DatabaseSync>,
  client: InstanceType<typeof Pool>["Client"],
  dryRun: boolean
) => {
  const table = tableDefinitions.find((definition) => definition.name === "users")!;
  const rows = readSqliteRows(sqliteDb, table);
  const statement = buildUpsertStatement(table);

  for (const row of rows) {
    const existing = (await client.query(
      "SELECT portfolio_json, portfolio_revision FROM users WHERE id = $1 FOR UPDATE",
      [row.id]
    )) as {
      rows: Array<{
        portfolio_json: string;
        portfolio_revision: number;
      }>;
    };
    const mergedPortfolio = mergePortfolioJson(
      row.portfolio_json ?? "{}",
      existing.rows[0]?.portfolio_json ?? null
    );

    console.log(
      `[portfolio-migration] user=${row.id} assets+${mergedPortfolio.report.addedAssets} sales+${mergedPortfolio.report.addedSales} adjustments+${mergedPortfolio.report.addedAdjustments} portfolios+${mergedPortfolio.report.addedPortfolios}`
    );

    if (dryRun) {
      continue;
    }

    const mergedRow: Record<string, string | null> = {
      ...row,
      portfolio_json: mergedPortfolio.portfolioJson,
    };
    await client.query(
      statement,
      table.columns.map((column) => mergedRow[column] ?? null)
    );

    if (existing.rows[0]) {
      await client.query(
        `
          UPDATE users
          SET portfolio_revision = portfolio_revision + 1,
              portfolio_core_revision = -1
          WHERE id = $1
        `,
        [row.id]
      );
    }
  }

  console.log(`${dryRun ? "Would import" : "Imported"} ${rows.length} rows into users.`);
};

const importTable = async (
  sqliteDb: InstanceType<typeof DatabaseSync>,
  client: InstanceType<typeof Pool>["Client"],
  table: TableDefinition,
  dryRun: boolean
) => {
  if (table.name === "users") {
    await importUsers(sqliteDb, client, dryRun);
    return;
  }

  const rows = readSqliteRows(sqliteDb, table);
  const statement = buildUpsertStatement(table);

  if (!dryRun) {
    for (const row of rows) {
      await client.query(
        statement,
        table.columns.map((column) => row[column] ?? null)
      );
    }
  }

  console.log(`${dryRun ? "Would import" : "Imported"} ${rows.length} rows into ${table.name}.`);
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
    const sourceRows = readSqliteRows(sqliteDb, table);
    const sourceKeys = sourceRows
      .map((row) => row[table.conflictColumn])
      .filter((value): value is string => typeof value === "string" && Boolean(value));
    const postgresCount = await client.query(
      sourceKeys.length > 0
        ? `
            SELECT COUNT(*)::int AS count
            FROM ${quoteIdentifier(table.name)}
            WHERE ${quoteIdentifier(table.conflictColumn)} = ANY($1::text[])
          `
        : `SELECT 0::int AS count`,
      sourceKeys.length > 0 ? [sourceKeys] : []
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
  const applyMigration = process.argv.includes("--apply");
  assertSqliteDatabaseExists();

  const sqliteDb = new DatabaseSync(sqlitePath, { readOnly: true });
  const pool = getPool();
  const client = await pool.connect();

  try {
    assertSqliteTablesExist(sqliteDb);

    await client.query("BEGIN");
    await client.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_core_revision INTEGER NOT NULL DEFAULT -1"
    );
    await assertPostgresTablesExist(client);
    await assertNoUserEmailConflicts(sqliteDb, client);

    for (const table of tableDefinitions) {
      await importTable(sqliteDb, client, table, !applyMigration);
    }

    const counts = await getCounts(sqliteDb, client);

    if (applyMigration) {
      assertCountsMatch(counts);
      await client.query("COMMIT");
      console.log("Migration finished successfully.");
    } else {
      await client.query("ROLLBACK");
      console.log("Dry run finished. No PostgreSQL data was changed. Run with --apply to import.");
    }

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
