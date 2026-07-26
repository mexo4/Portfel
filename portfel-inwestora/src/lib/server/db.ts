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
