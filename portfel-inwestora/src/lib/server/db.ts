import { readFileSync } from "node:fs";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

type QueryParameter = string | number | boolean | null | string[] | number[];

export type DatabaseTransaction = {
  query: <T>(statement: string, parameters?: QueryParameter[]) => Promise<T[]>;
  execute: (statement: string, parameters?: QueryParameter[]) => Promise<void>;
};

let schemaInitialization: Promise<void> | null = null;

declare global {
  var portfelPostgresPool: Pool | undefined;
}

const getDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Brakuje zmiennej srodowiskowej DATABASE_URL dla PostgreSQL.");
  }

  return databaseUrl;
};

const getConnectionString = () => {
  const databaseUrl = new URL(getDatabaseUrl());
  databaseUrl.searchParams.delete("sslmode");
  return databaseUrl.toString();
};

const getSslConfiguration = () => {
  const certificateBase64 = process.env.POSTGRES_CA_CERT_BASE64?.trim();
  const certificatePath = process.env.POSTGRES_CA_CERT_PATH?.trim();

  if (certificateBase64) {
    const certificate = Buffer.from(certificateBase64, "base64").toString("utf8");

    if (!certificate.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error("POSTGRES_CA_CERT_BASE64 nie zawiera prawidlowego certyfikatu CA.");
    }

    return {
      ca: certificate,
      rejectUnauthorized: true,
    };
  }

  if (!certificatePath) {
    return undefined;
  }

  return {
    ca: readFileSync(certificatePath, "utf8"),
    rejectUnauthorized: true,
  };
};

const getPool = () => {
  if (!globalThis.portfelPostgresPool) {
    const ssl = getSslConfiguration();

    globalThis.portfelPostgresPool = new Pool({
      // When a CA is supplied (Aiven), provide an explicit verified TLS
      // configuration. Otherwise preserve the TLS policy encoded in an
      // existing standard PostgreSQL URI (for example sslmode=require).
      connectionString: ssl ? getConnectionString() : getDatabaseUrl(),
      ...(ssl ? { ssl } : {}),
      // A small, shared pool works both on serverless runtimes and Aiven Free,
      // where each runtime should consume as few database connections as possible.
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return globalThis.portfelPostgresPool;
};

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      display_name TEXT NOT NULL,
      email_verified_at TEXT,
      subscription_plan TEXT NOT NULL DEFAULT 'free',
      subscription_status TEXT NOT NULL DEFAULT 'active',
      subscription_updated_at TEXT,
      profile_json TEXT NOT NULL,
      portfolio_json TEXT NOT NULL,
      portfolio_revision INTEGER NOT NULL DEFAULT 0,
      portfolio_core_revision INTEGER NOT NULL DEFAULT -1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (provider, provider_account_id)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_auth_accounts_user_id ON auth_accounts(user_id)",
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
    CREATE TABLE IF NOT EXISTS portfolio_asset_quotes (
      portfolio_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      quote_timestamp TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (portfolio_id, asset_id),
      FOREIGN KEY (portfolio_id) REFERENCES core_portfolios(id) ON DELETE CASCADE
    )
  `,
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
    CREATE TABLE IF NOT EXISTS corporate_event_instruments (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      market TEXT NOT NULL,
      isin TEXT,
      ticker TEXT NOT NULL,
      company_name TEXT NOT NULL,
      last_checked_at TEXT,
      last_source_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_corporate_event_instruments_market_ticker ON corporate_event_instruments(market, ticker)",
  `
    CREATE TABLE IF NOT EXISTS corporate_events (
      id TEXT PRIMARY KEY,
      instrument_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      fiscal_period TEXT,
      fiscal_year INTEGER,
      status TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      source_published_at TEXT,
      source_type TEXT,
      source_priority INTEGER NOT NULL DEFAULT 0,
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (instrument_id) REFERENCES corporate_event_instruments(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_events_active_identity
    ON corporate_events(
      instrument_id,
      event_type,
      COALESCE(fiscal_period, ''),
      COALESCE(fiscal_year, 0)
    )
    WHERE active = TRUE
  `,
  "CREATE INDEX IF NOT EXISTS idx_corporate_events_date ON corporate_events(event_date) WHERE active = TRUE",
  `
    CREATE TABLE IF NOT EXISTS corporate_event_sources (
      id TEXT PRIMARY KEY,
      corporate_event_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_published_at TEXT,
      source_priority INTEGER NOT NULL DEFAULT 0,
      discovered_at TEXT NOT NULL,
      FOREIGN KEY (corporate_event_id) REFERENCES corporate_events(id) ON DELETE CASCADE,
      UNIQUE (corporate_event_id, source_url)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_corporate_event_sources_event_id ON corporate_event_sources(corporate_event_id)",
  `
    CREATE TABLE IF NOT EXISTS corporate_event_source_checks (
      id TEXT PRIMARY KEY,
      instrument_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      last_checked_at TEXT NOT NULL,
      last_status TEXT NOT NULL,
      last_duration_ms INTEGER,
      FOREIGN KEY (instrument_id) REFERENCES corporate_event_instruments(id) ON DELETE CASCADE,
      UNIQUE (instrument_id, source_url)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_corporate_event_source_checks_instrument_id ON corporate_event_source_checks(instrument_id)",
  `
    CREATE TABLE IF NOT EXISTS corporate_event_history (
      id TEXT PRIMARY KEY,
      corporate_event_id TEXT NOT NULL,
      previous_event_date TEXT NOT NULL,
      next_event_date TEXT NOT NULL,
      source_url TEXT,
      detected_at TEXT NOT NULL,
      FOREIGN KEY (corporate_event_id) REFERENCES corporate_events(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_corporate_event_history_event_id ON corporate_event_history(corporate_event_id)",
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
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_revision INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_core_revision INTEGER NOT NULL DEFAULT -1",
  "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
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

const createTransaction = (client: PoolClient): DatabaseTransaction => ({
  query: async <T>(statement: string, parameters: QueryParameter[] = []) => {
    const result = await client.query<T & QueryResultRow>(statement, parameters);
    return result.rows;
  },
  execute: async (statement: string, parameters: QueryParameter[] = []) => {
    await client.query(statement, parameters);
  },
});

export const withTransaction = async <T>(
  callback: (transaction: DatabaseTransaction) => Promise<T>
) => {
  await initializeDatabase();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback(createTransaction(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original database error is more useful to the caller.
    }

    throw error;
  } finally {
    client.release();
  }
};
