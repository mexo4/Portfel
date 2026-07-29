import { Pool, type QueryResultRow } from "pg";

type QueryParameter = string | number | boolean | null;

let schemaInitialization: Promise<void> | null = null;

declare global {
  var portfelPostgresPool: Pool | undefined;
}

const getDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Brakuje zmiennej srodowiskowej DATABASE_URL dla PostgreSQL/Neon.");
  }

  return databaseUrl;
};

const getConnectionString = () => {
  const databaseUrl = new URL(getDatabaseUrl());
  databaseUrl.searchParams.delete("sslmode");
  return databaseUrl.toString();
};

const getPool = () => {
  if (!globalThis.portfelPostgresPool) {
    globalThis.portfelPostgresPool = new Pool({
      connectionString: getConnectionString(),
      ssl: {
        rejectUnauthorized: true,
      },
    });
  }

  return globalThis.portfelPostgresPool;
};

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email_verified_at TEXT,
      subscription_plan TEXT NOT NULL DEFAULT 'free',
      subscription_status TEXT NOT NULL DEFAULT 'active',
      subscription_updated_at TEXT,
      profile_json TEXT NOT NULL,
      portfolio_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
  `
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id
      ON email_verification_tokens(user_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
      ON password_reset_tokens(user_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS market_cache (
      "key" TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS core_portfolios (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      base_currency TEXT NOT NULL DEFAULT 'PLN',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_portfolios_user_id ON core_portfolios(user_id)",
  `
    CREATE TABLE IF NOT EXISTS core_sub_portfolios (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'PLN',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_sub_portfolios_portfolio_id ON core_sub_portfolios(portfolio_id)",
  `
    CREATE TABLE IF NOT EXISTS core_accounts (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      parent_account_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      broker TEXT,
      currency TEXT NOT NULL DEFAULT 'PLN',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_account_id) REFERENCES core_accounts(id) ON DELETE SET NULL
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_accounts_portfolio_id ON core_accounts(portfolio_id)",
  `
    CREATE TABLE IF NOT EXISTS core_instruments (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      type TEXT NOT NULL,
      asset_kind TEXT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market_currency TEXT NOT NULL DEFAULT 'PLN',
      provider TEXT,
      provider_id TEXT,
      isin TEXT,
      price_scale DOUBLE PRECISION,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_instruments_portfolio_id ON core_instruments(portfolio_id)",
  "CREATE INDEX IF NOT EXISTS idx_core_instruments_symbol ON core_instruments(symbol)",
  `
    CREATE TABLE IF NOT EXISTS core_operations (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      asset_id TEXT,
      operation_type TEXT NOT NULL,
      quantity DOUBLE PRECISION,
      price DOUBLE PRECISION,
      currency TEXT NOT NULL DEFAULT 'PLN',
      exchange_rate DOUBLE PRECISION,
      fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      tax DOUBLE PRECISION NOT NULL DEFAULT 0,
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES core_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES core_instruments(id) ON DELETE SET NULL
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_operations_portfolio_id ON core_operations(portfolio_id)",
  "CREATE INDEX IF NOT EXISTS idx_core_operations_account_id ON core_operations(account_id)",
  "CREATE INDEX IF NOT EXISTS idx_core_operations_asset_id ON core_operations(asset_id)",
  "CREATE INDEX IF NOT EXISTS idx_core_operations_date ON core_operations(date)",
  `
    CREATE TABLE IF NOT EXISTS core_tags (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_tags_portfolio_id ON core_tags(portfolio_id)",
  `
    CREATE TABLE IF NOT EXISTS core_tag_assignments (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES core_tags(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_tag_assignments_portfolio_id ON core_tag_assignments(portfolio_id)",
  "CREATE INDEX IF NOT EXISTS idx_core_tag_assignments_target ON core_tag_assignments(target_type, target_id)",
  `
    CREATE TABLE IF NOT EXISTS core_benchmarks (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      market_currency TEXT NOT NULL DEFAULT 'PLN',
      provider TEXT NOT NULL,
      provider_id TEXT,
      price_scale DOUBLE PRECISION,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_core_benchmarks_portfolio_id ON core_benchmarks(portfolio_id)",
  `
    CREATE TABLE IF NOT EXISTS portfolio_engine_cache (
      "key" TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_portfolio_engine_cache_portfolio_id ON portfolio_engine_cache(portfolio_id)",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free'",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active'",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_updated_at TEXT",
] as const;

export const initializeDatabase = async () => {
  if (!schemaInitialization) {
    schemaInitialization = (async () => {
      for (const statement of schemaStatements) {
        await getPool().query(statement);
      }
    })().catch((error) => {
      schemaInitialization = null;
      throw error;
    });
  }

  return schemaInitialization;
};

export const query = async <T>(
  statement: string,
  parameters: QueryParameter[] = []
) => {
  await initializeDatabase();
  const result = await getPool().query<T & QueryResultRow>(statement, parameters);
  return result.rows;
};

export const queryOne = async <T>(
  statement: string,
  parameters: QueryParameter[] = []
) => {
  const rows = await query<T>(statement, parameters);
  return rows[0];
};

export const execute = async (
  statement: string,
  parameters: QueryParameter[] = []
) => {
  await query<Record<string, never>>(statement, parameters);
};
