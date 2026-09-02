import { readFileSync } from "node:fs";
import { Client, type QueryResultRow } from "pg";

type QueryParameter = string | number | boolean | null | string[] | number[];

export type DatabaseTransaction = {
  query: <T>(statement: string, parameters?: QueryParameter[]) => Promise<T[]>;
  execute: (statement: string, parameters?: QueryParameter[]) => Promise<void>;
};

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

type CloudflareWorkersModule = {
  env?: {
    HYPERDRIVE?: {
      connectionString?: string;
    };
  };
};

const getHyperdriveConnectionString = async () => {
  try {
    // Dynamic import keeps the Node test runner and local migration scripts
    // usable while vinext resolves this built-in module in Workers.
    const cloudflareWorkers = (await import("cloudflare:workers")) as CloudflareWorkersModule;
    return cloudflareWorkers.env?.HYPERDRIVE?.connectionString;
  } catch {
    return undefined;
  }
};

const getClientConfiguration = async () => {
  // In a deployed Worker Hyperdrive owns the origin pool and verified TLS
  // session. The Node fallback is used only by local scripts and local dev.
  const hyperdriveConnectionString = await getHyperdriveConnectionString();

  if (hyperdriveConnectionString) {
    return { connectionString: hyperdriveConnectionString };
  }

  const ssl = getSslConfiguration();

  return {
    connectionString: ssl ? getConnectionString() : getDatabaseUrl(),
    ...(ssl ? { ssl } : {}),
    connectionTimeoutMillis: 10_000,
  };
};

const withClient = async <T>(callback: (client: Client) => Promise<T>) => {
  // A Client is intentionally scoped to this database operation. Workers may
  // reuse an isolate after its request has completed, but I/O objects may not
  // cross that request boundary. Hyperdrive performs safe pooling upstream.
  const client = new Client(await getClientConfiguration());
  let operationError: unknown;

  try {
    await client.connect();
    return await callback(client);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await client.end();
    } catch (closeError) {
      if (!operationError) {
        throw closeError;
      }
    }
  }
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
    CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
      user_id TEXT PRIMARY KEY,
      layout_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS user_dashboard_layout_scopes (
      user_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      desktop_layout_json TEXT NOT NULL,
      mobile_layout_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, scope_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_dashboard_layout_scopes_user_id ON user_dashboard_layout_scopes(user_id)",
  `
    CREATE TABLE IF NOT EXISTS user_performance_preferences (
      user_id TEXT PRIMARY KEY,
      visible_metrics_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      account_type TEXT NOT NULL DEFAULT 'STANDARD',
      account_config_json TEXT NOT NULL DEFAULT '{}',
      base_currency TEXT NOT NULL DEFAULT 'PLN',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT chk_core_portfolios_account_type
        CHECK (account_type IN ('STANDARD', 'IKE', 'IKZE', 'OKI')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
  "ALTER TABLE core_portfolios ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'STANDARD'",
  "ALTER TABLE core_portfolios ADD COLUMN IF NOT EXISTS account_config_json TEXT NOT NULL DEFAULT '{}'",
  `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_core_portfolios_account_type'
      ) THEN
        ALTER TABLE core_portfolios
          ADD CONSTRAINT chk_core_portfolios_account_type
          CHECK (account_type IN ('STANDARD', 'IKE', 'IKZE', 'OKI'));
      END IF;
    END
    $$
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
    CREATE TABLE IF NOT EXISTS user_watchlist_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market_currency TEXT NOT NULL DEFAULT 'PLN',
      provider TEXT,
      provider_id TEXT,
      isin TEXT,
      core_instrument_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (core_instrument_id) REFERENCES core_instruments(id) ON DELETE SET NULL,
      UNIQUE (user_id, canonical_key)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_user_watchlist_items_user_id ON user_watchlist_items(user_id)",
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
      event_identity TEXT NOT NULL DEFAULT '',
      dividend_per_share DOUBLE PRECISION,
      dividend_total_per_share DOUBLE PRECISION,
      dividend_advance_per_share DOUBLE PRECISION,
      dividend_currency TEXT,
      ex_dividend_date TEXT,
      record_date TEXT,
      payment_date TEXT,
      dividend_installment INTEGER,
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
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS event_identity TEXT",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS dividend_per_share DOUBLE PRECISION",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS dividend_total_per_share DOUBLE PRECISION",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS dividend_advance_per_share DOUBLE PRECISION",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS dividend_currency TEXT",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS ex_dividend_date TEXT",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS record_date TEXT",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS payment_date TEXT",
  "ALTER TABLE corporate_events ADD COLUMN IF NOT EXISTS dividend_installment INTEGER",
  `
    UPDATE corporate_events
    SET event_identity = event_type || ':' || COALESCE(fiscal_period, '') || ':' || COALESCE(fiscal_year::TEXT, '')
    WHERE event_identity IS NULL OR event_identity = ''
  `,
  "ALTER TABLE corporate_events ALTER COLUMN event_identity SET DEFAULT ''",
  "ALTER TABLE corporate_events ALTER COLUMN event_identity SET NOT NULL",
  "DROP INDEX IF EXISTS idx_corporate_events_active_identity",
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_events_active_identity
    ON corporate_events(instrument_id, event_type, event_identity)
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
    CREATE TABLE IF NOT EXISTS espi_reports (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      issuer_id TEXT,
      issuer_name TEXT NOT NULL,
      source_ticker TEXT,
      source_isin TEXT,
      report_number TEXT,
      report_type TEXT NOT NULL,
      published_at TEXT NOT NULL,
      source_title TEXT NOT NULL,
      title TEXT NOT NULL,
      body_text TEXT NOT NULL,
      legal_basis TEXT,
      category TEXT NOT NULL,
      source_url TEXT NOT NULL,
      is_correction BOOLEAN NOT NULL DEFAULT FALSE,
      correction_target_report_number TEXT,
      correction_of_report_id TEXT,
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (issuer_id) REFERENCES corporate_event_instruments(id) ON DELETE SET NULL,
      FOREIGN KEY (correction_of_report_id) REFERENCES espi_reports(id) ON DELETE SET NULL,
      UNIQUE (source, source_id),
      UNIQUE (source_url)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_espi_reports_published ON espi_reports(published_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_espi_reports_issuer_published ON espi_reports(issuer_id, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_espi_reports_isin_published ON espi_reports(source_isin, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_espi_reports_ticker_published ON espi_reports(source_ticker, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_espi_reports_category_published ON espi_reports(category, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_espi_reports_type_published ON espi_reports(report_type, published_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_espi_reports_correction_of ON espi_reports(correction_of_report_id) WHERE correction_of_report_id IS NOT NULL",
  `
    CREATE INDEX IF NOT EXISTS idx_espi_reports_search
    ON espi_reports USING GIN (
      to_tsvector(
        'simple'::regconfig,
        COALESCE(issuer_name, '') || ' ' || COALESCE(source_ticker, '') || ' ' ||
        COALESCE(report_number, '') || ' ' || COALESCE(title, '') || ' ' || COALESCE(body_text, '')
      )
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS espi_report_attachments (
      id TEXT PRIMARY KEY,
      espi_report_id TEXT NOT NULL,
      name TEXT NOT NULL,
      media_type TEXT,
      size_label TEXT,
      source_url TEXT NOT NULL,
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (espi_report_id) REFERENCES espi_reports(id) ON DELETE CASCADE,
      UNIQUE (espi_report_id, source_url)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_espi_attachments_report ON espi_report_attachments(espi_report_id)",
  `
    CREATE TABLE IF NOT EXISTS espi_sync_state (
      source TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error_code TEXT,
      next_backfill_page INTEGER NOT NULL DEFAULT 1,
      backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
      lock_token TEXT,
      lock_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
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

const schemaBatch = schemaStatements.map((statement) => `${statement.trim()};`).join("\n");

const getSchemaFingerprint = async () => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(schemaBatch)
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const hasPostgresErrorCode = (error: unknown, code: string) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === code;

const isSchemaApplied = async (client: Client, fingerprint: string) => {
  try {
    const result = await client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM portfel_schema_migrations WHERE fingerprint = $1) AS exists",
      [fingerprint]
    );
    return result.rows[0]?.exists === true;
  } catch (error) {
    // PostgreSQL's undefined_table. A first deployment creates the state
    // table under the advisory lock below.
    if (hasPostgresErrorCode(error, "42P01")) {
      return false;
    }
    throw error;
  }
};

const initializeDatabaseWithClient = async (client: Client) => {
  const fingerprint = await getSchemaFingerprint();

  if (await isSchemaApplied(client, fingerprint)) {
    return;
  }

  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    // DDL has to be serialized across concurrent first requests. The lock is
    // owned by this transaction and is released on COMMIT or ROLLBACK.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "mexo-postgres-schema",
    ]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfel_schema_migrations (
        fingerprint TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    if (await isSchemaApplied(client, fingerprint)) {
      await client.query("COMMIT");
      transactionStarted = false;
      return;
    }

    await client.query(schemaBatch);
    await client.query(
      "INSERT INTO portfel_schema_migrations (fingerprint) VALUES ($1) ON CONFLICT DO NOTHING",
      [fingerprint]
    );
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the schema initialization error.
      }
    }
    throw error;
  }
};

export const initializeDatabase = async () =>
  withClient(async (client) => initializeDatabaseWithClient(client));

export const query = async <T>(
  statement: string,
  parameters: QueryParameter[] = []
) => {
  return withClient(async (client) => {
    await initializeDatabaseWithClient(client);
    const result = await client.query<T & QueryResultRow>(statement, parameters);
    return result.rows;
  });
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

const createTransaction = (client: Client): DatabaseTransaction => ({
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
) =>
  withClient(async (client) => {
    await initializeDatabaseWithClient(client);
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const result = await callback(createTransaction(client));
      await client.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The original database error is more useful to the caller.
        }
      }

      throw error;
    }
  });
