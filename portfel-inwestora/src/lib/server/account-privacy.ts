import { createHash, randomBytes, randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { canDeleteAdministrator, MAX_ACCOUNT_EXPORT_ROWS_PER_DATASET, MAX_ACCOUNT_EXPORT_TOTAL_ROWS, MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES } from "@/lib/account-lifecycle";
import { buildOperationsCsv, createExportManifest, parseStoredJson, stripAutomaticQuotesFromLegacyPortfolio } from "@/lib/privacy-export";
import { query, withTransaction } from "@/lib/server/db";

const PAGE_SIZE = 500;
const DELETION_CHALLENGE_TTL_MS = 10 * 60_000;
const ADMIN_LIFECYCLE_LOCK = "734219806541";

export class AccountExportTooLargeError extends Error {
  constructor() {
    super("Eksport przekracza bezpieczny limit. Skontaktuj się z Mexo, aby otrzymać bezpieczną kopię danych.");
    this.name = "AccountExportTooLargeError";
  }
}

export class AccountDeletionError extends Error {
  readonly code: "challenge_invalid" | "admin_transfer_required" | "account_unavailable";
  constructor(code: AccountDeletionError["code"], message: string) {
    super(message);
    this.name = "AccountDeletionError";
    this.code = code;
  }
}

type ExportTable = {
  file: string;
  table: string;
  where: string;
  order: string;
  values: Array<string | string[]>;
};

type ExportReadBudget = { rows: number; estimatedBytes: number };

const readPagedRows = async (
  transaction: Parameters<Parameters<typeof withTransaction>[0]>[0],
  spec: ExportTable,
  budget: ExportReadBudget
) => {
  const checks = await transaction.query<{ row_count: string; logical_bytes: string }>(
    `SELECT count(*)::text AS row_count,
       COALESCE(sum(octet_length(row_to_json(source)::text)), 0)::text AS logical_bytes
     FROM ${spec.table} AS source WHERE ${spec.where}`,
    spec.values
  );
  const rowCount = Number(checks[0]?.row_count ?? 0);
  const logicalBytes = Number(checks[0]?.logical_bytes ?? 0);
  if (!Number.isSafeInteger(rowCount) || rowCount > MAX_ACCOUNT_EXPORT_ROWS_PER_DATASET ||
      !Number.isSafeInteger(logicalBytes) || logicalBytes < 0) {
    throw new AccountExportTooLargeError();
  }
  budget.rows += rowCount;
  budget.estimatedBytes += logicalBytes;
  if (budget.rows > MAX_ACCOUNT_EXPORT_TOTAL_ROWS || budget.estimatedBytes > MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES) {
    throw new AccountExportTooLargeError();
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const limitParameter = spec.values.length + 1;
    const offsetParameter = spec.values.length + 2;
    const page = await transaction.query<Record<string, unknown>>(
      `SELECT * FROM ${spec.table} WHERE ${spec.where} ORDER BY ${spec.order} LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
      [...spec.values, PAGE_SIZE, offset]
    );
    rows.push(...page);
    if (rows.length > MAX_ACCOUNT_EXPORT_ROWS_PER_DATASET) throw new AccountExportTooLargeError();
    if (page.length < PAGE_SIZE) return rows;
  }
};

const toPrettyJson = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");

/** Builds an authenticated account export from one repeatable-read database snapshot. */
export const createAccountDataExport = async (userId: string) => {
  const exportId = randomUUID();
  const generatedAt = new Date().toISOString();
  const files = await withTransaction(async (transaction) => {
  await transaction.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const readBudget: ExportReadBudget = { rows: 0, estimatedBytes: 0 };
  const userSizeRows = await transaction.query<{ profile_bytes: string; portfolio_bytes: string }>(
    `SELECT octet_length(profile_json)::text AS profile_bytes,
       octet_length(portfolio_json)::text AS portfolio_bytes
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!userSizeRows.length) return null;
  const userLogicalBytes = Number(userSizeRows[0].profile_bytes) + Number(userSizeRows[0].portfolio_bytes);
  if (!Number.isSafeInteger(userLogicalBytes) || userLogicalBytes < 0 || userLogicalBytes > MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES) {
    throw new AccountExportTooLargeError();
  }
  readBudget.rows = 1;
  readBudget.estimatedBytes = userLogicalBytes;
  const userRows = await transaction.query<{
    id: string; email: string; display_name: string; email_verified_at: string | null;
    subscription_plan: string; subscription_status: string; subscription_activated_at: string | null;
    subscription_expires_at: string | null; subscription_updated_at: string | null;
    subscription_grant_source: string | null; user_role: string; tester_access: boolean;
    espi_access: boolean; profile_json: string; portfolio_json: string; created_at: string; updated_at: string;
  }>(
    `SELECT id, email, display_name, email_verified_at, subscription_plan, subscription_status,
      subscription_activated_at, subscription_expires_at, subscription_updated_at,
      subscription_grant_source, user_role, tester_access, espi_access,
      profile_json, portfolio_json, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );
  const user = userRows[0];
  if (!user) return null;
  const authProviders = await readPagedRows(transaction, {
    file: "authentication.json", table: "auth_accounts", where: "user_id = $1", order: "provider ASC, id ASC", values: [userId],
  }, readBudget);

  const portfolioRows = await readPagedRows(transaction, {
    file: "portfolios.json", table: "core_portfolios", where: "user_id = $1", order: "id ASC", values: [userId],
  }, readBudget);
  const portfolioIds = portfolioRows.map((row) => String(row.id));
  const portfolioSpec = (file: string, table: string, order: string): ExportTable => ({
    file, table, where: "portfolio_id = ANY($1::text[])", order, values: [portfolioIds],
  });
  const ownedSpecs: ExportTable[] = portfolioIds.length ? [
    portfolioSpec("sub-portfolios.json", "core_sub_portfolios", "id ASC"),
    portfolioSpec("accounts.json", "core_accounts", "id ASC"),
    portfolioSpec("instruments.json", "core_instruments", "id ASC"),
    portfolioSpec("operations.json", "core_operations", "date ASC, id ASC"),
    portfolioSpec("tags.json", "core_tags", "id ASC"),
    portfolioSpec("tag-assignments.json", "core_tag_assignments", "id ASC"),
    portfolioSpec("benchmarks.json", "core_benchmarks", "id ASC"),
  ] : [];
  const ownedDatasets = new Map<string, Array<Record<string, unknown>>>();
  for (const spec of ownedSpecs) ownedDatasets.set(spec.file, await readPagedRows(transaction, spec, readBudget));

  const watchlist = await readPagedRows(transaction, {
    file: "watchlist.json", table: "user_watchlist_items", where: "user_id = $1", order: "id ASC", values: [userId],
  }, readBudget);
  const dashboardLayouts = await readPagedRows(transaction, {
    file: "dashboard-layouts.json", table: "user_dashboard_layouts", where: "user_id = $1", order: "user_id ASC", values: [userId],
  }, readBudget);
  const dashboardScopes = await readPagedRows(transaction, {
    file: "dashboard-scopes.json", table: "user_dashboard_layout_scopes", where: "user_id = $1", order: "scope_key ASC", values: [userId],
  }, readBudget);
  const preferences = await readPagedRows(transaction, {
    file: "performance-preferences.json", table: "user_performance_preferences", where: "user_id = $1", order: "user_id ASC", values: [userId],
  }, readBudget);
  const subscriptions = await readPagedRows(transaction, {
    file: "calendar-subscriptions.json", table: "user_calendar_subscriptions", where: "user_id = $1", order: "id ASC", values: [userId],
  }, readBudget);

  const manualQuoteRows = portfolioIds.length ? await readPagedRows(transaction, {
    file: "manual-prices.json",
    table: "portfolio_asset_quotes",
    where: "portfolio_id = ANY($1::text[])",
    order: "portfolio_id ASC, asset_id ASC",
    values: [portfolioIds],
  }, readBudget) : [];
  const manualPrices = manualQuoteRows.flatMap((row) => {
    const snapshot = parseStoredJson(String(row.payload_json ?? ""), "manual quote") as Record<string, unknown>;
    if (snapshot.priceSource !== "MANUAL") return [];
    return {
      portfolioId: String(row.portfolio_id),
      assetId: String(row.asset_id),
      latestPrice: snapshot.latestPrice ?? null,
      marketCurrency: snapshot.marketCurrency ?? null,
      latestPriceDate: snapshot.latestPriceDate ?? null,
      quoteTimestamp: String(row.quote_timestamp),
      updatedAt: String(row.updated_at),
      priceSource: "MANUAL",
    };
  });

  const operationRows = ownedDatasets.get("operations.json") ?? [];
  const dividendRows = operationRows.filter((row) => String(row.operation_type ?? "").toUpperCase() === "DIVIDEND");
  const cashflowTypes = new Set(["DEPOSIT", "WITHDRAW", "TRANSFER", "CONVERSION", "INTEREST", "FEE", "TAX", "CUSTOM"]);
  const cashflowRows = operationRows.filter((row) => cashflowTypes.has(String(row.operation_type ?? "").toUpperCase()));
  const safeSubscriptions = subscriptions.map((row) => ({
    id: row.id, name: row.name, scope_mode: row.scope_mode,
    categories_json: row.categories_json, portfolio_ids_json: row.portfolio_ids_json,
    manual_tickers_json: row.manual_tickers_json, token_version: row.token_version,
    revoked_at: row.revoked_at, created_at: row.created_at, updated_at: row.updated_at,
  }));
  const dashboard = { layouts: dashboardLayouts, scopes: dashboardScopes };
  const account = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    emailVerifiedAt: user.email_verified_at,
    subscription: {
      plan: user.subscription_plan, status: user.subscription_status,
      activatedAt: user.subscription_activated_at, expiresAt: user.subscription_expires_at,
      updatedAt: user.subscription_updated_at, grantSource: user.subscription_grant_source,
    },
    role: user.user_role,
    testerAccess: user.tester_access,
    espiAccess: user.espi_access,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    profile: parseStoredJson(user.profile_json, "profile_json"),
  };
  const dataFiles: Record<string, string> = {
    "account.json": toPrettyJson(account),
    "authentication.json": toPrettyJson(authProviders.map((row) => ({
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      linkedAt: row.created_at,
    }))),
    "legacy-portfolio.json": toPrettyJson(stripAutomaticQuotesFromLegacyPortfolio(parseStoredJson(user.portfolio_json, "portfolio_json"))),
    "portfolios.json": toPrettyJson(portfolioRows),
    "sub-portfolios.json": toPrettyJson(ownedDatasets.get("sub-portfolios.json") ?? []),
    "accounts.json": toPrettyJson(ownedDatasets.get("accounts.json") ?? []),
    "instruments.json": toPrettyJson(ownedDatasets.get("instruments.json") ?? []),
    "operations.json": toPrettyJson(operationRows),
    "operations.csv": buildOperationsCsv(operationRows),
    "dividends.csv": buildOperationsCsv(dividendRows),
    "cashflows.csv": buildOperationsCsv(cashflowRows),
    "tags.json": toPrettyJson(ownedDatasets.get("tags.json") ?? []),
    "tag-assignments.json": toPrettyJson(ownedDatasets.get("tag-assignments.json") ?? []),
    "benchmarks.json": toPrettyJson(ownedDatasets.get("benchmarks.json") ?? []),
    "watchlist.json": toPrettyJson(watchlist),
    "dashboard.json": toPrettyJson(dashboard),
    "performance-preferences.json": toPrettyJson(preferences),
    "calendar-subscriptions.json": toPrettyJson(safeSubscriptions),
    "manual-prices.json": toPrettyJson(manualPrices),
    "README.txt": [
      "Mexo — eksport danych użytkownika",
      "",
      `Identyfikator eksportu: ${exportId}`,
      `Wygenerowano (UTC): ${generatedAt}`,
      "Wartości JSON zachowują zapisane precyzje. Waluty pozostają oryginalne; eksport nie przelicza kwot.",
      "Pliki CSV są UTF-8 i zawierają BOM dla zgodności z arkuszami kalkulacyjnymi. Tekst rozpoczynający formułę jest zabezpieczony.",
      "manifest.json opisuje pliki i liczbę rekordów. Nie zawiera haseł, tokenów sesji, tokenów OAuth ani tokenów prywatnego feedu kalendarza.",
      "Dane rynku współdzielone przez użytkowników i cache dostawców nie są częścią eksportu.",
      "",
    ].join("\n"),
  };
  const totalBytes = Object.values(dataFiles).reduce((sum, content) => sum + byteLength(content), 0);
  if (totalBytes > MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES) throw new AccountExportTooLargeError();
  const summaries = Object.fromEntries(Object.entries(dataFiles).map(([path, content]) => {
    const recordCount = path.endsWith(".csv")
      ? (path === "operations.csv" ? operationRows.length : path === "dividends.csv" ? dividendRows.length : cashflowRows.length)
      : path === "account.json" || path === "legacy-portfolio.json" ? 1
        : path === "dashboard.json" ? dashboardLayouts.length + dashboardScopes.length
          : path === "README.txt" ? 1
            : path === "manual-prices.json" ? manualPrices.length
              : path === "authentication.json" ? authProviders.length
                : path === "portfolios.json" ? portfolioRows.length
                  : path === "sub-portfolios.json" || path === "accounts.json" || path === "instruments.json" || path === "operations.json" || path === "tags.json" || path === "tag-assignments.json" || path === "benchmarks.json"
                    ? ownedDatasets.get(path)?.length ?? 0
                    : path === "watchlist.json" ? watchlist.length
                      : path === "performance-preferences.json" ? preferences.length
                        : path === "calendar-subscriptions.json" ? safeSubscriptions.length
                          : 0;
    return [path, { records: recordCount, bytes: byteLength(content) }];
  }));
  const files = {
    "manifest.json": toPrettyJson(createExportManifest(generatedAt, { exportId, files: summaries })),
    ...dataFiles,
  };
  if (Object.values(files).reduce((sum, content) => sum + byteLength(content), 0) > MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES) {
    throw new AccountExportTooLargeError();
  }
  return files;
  });
  if (!files) return null;
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])), { level: 6 });
  if (archive.byteLength > MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES) throw new AccountExportTooLargeError();
  return archive;
};

export const issueAccountDeletionChallenge = async (userId: string) => {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DELETION_CHALLENGE_TTL_MS);
  await withTransaction(async (transaction) => {
    const user = await transaction.query<{ id: string }>("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    if (!user.length) throw new Error("Konto nie jest już dostępne.");
    await transaction.execute("DELETE FROM account_deletion_challenges WHERE user_id = $1", [userId]);
    await transaction.execute(
      "INSERT INTO account_deletion_challenges (user_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4)",
      [userId, tokenHash, now.toISOString(), expiresAt.toISOString()]
    );
  });
  return { token, expiresAt };
};

export const deleteAccountAfterReauthentication = async (userId: string, token: string) => {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await withTransaction(async (transaction) => {
    // Serialize every account deletion so simultaneous admin removals cannot
    // each observe the other as the remaining administrator.
    await transaction.query("SELECT pg_advisory_xact_lock($1::bigint)", [ADMIN_LIFECYCLE_LOCK]);
    const users = await transaction.query<{ id: string; user_role: string }>(
      "SELECT id, user_role FROM users WHERE id = $1 FOR UPDATE", [userId]
    );
    const user = users[0];
    if (!user) throw new AccountDeletionError("account_unavailable", "Konto nie jest już dostępne.");
    const challenge = await transaction.query<{ user_id: string }>(
      `SELECT user_id FROM account_deletion_challenges
       WHERE user_id = $1 AND token_hash = $2 AND expires_at::timestamptz > now() FOR UPDATE`,
      [userId, tokenHash]
    );
    if (!challenge.length) throw new AccountDeletionError("challenge_invalid", "Potwierdzenie wygasło lub jest nieprawidłowe. Zweryfikuj tożsamość ponownie.");
    // Consume the validated challenge for every accepted deletion attempt,
    // including a last-admin guard. The transaction commits the consumption
    // while leaving the account intact if an operator handoff is required.
    await transaction.execute("DELETE FROM account_deletion_challenges WHERE user_id = $1", [userId]);
    if (user.user_role === "admin") {
      const admins = await transaction.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE user_role = 'admin'");
      if (!canDeleteAdministrator(user.user_role, Number(admins[0]?.count ?? 0))) {
        return { blocked: "admin_transfer_required" as const };
      }
    }
    await transaction.execute(
      `DELETE FROM portfolio_engine_cache WHERE portfolio_id IN
       (SELECT id FROM core_portfolios WHERE user_id = $1)`, [userId]
    );
    await transaction.execute("DELETE FROM users WHERE id = $1", [userId]);
    return { blocked: null };
  });
  if (result.blocked === "admin_transfer_required") {
    throw new AccountDeletionError("admin_transfer_required", "Przed usunięciem tego konta przekaż rolę administratora innemu użytkownikowi.");
  }
};

export const verifyAccountPasswordForStepUp = async (userId: string, password: string) => {
  const { default: bcrypt } = await import("bcryptjs");
  const rows = await query<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const hash = rows[0]?.password_hash;
  if (!hash || !password) return false;
  return bcrypt.compare(password, hash);
};
