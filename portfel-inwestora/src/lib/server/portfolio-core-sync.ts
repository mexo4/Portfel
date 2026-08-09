import { withTransaction, type DatabaseTransaction } from "@/lib/server/db";
import type { PortfolioBook } from "@/types/portfolio";

const stringifyMetadata = (value: Record<string, unknown> | undefined) =>
  JSON.stringify(value ?? {});

const serializeRows = (rows: Record<string, unknown>[]) => JSON.stringify(rows);

const assertRowsBelongToUser = async (
  transaction: DatabaseTransaction,
  userId: string,
  tableName: string,
  rowIds: string[],
  directUserOwnership = false
) => {
  if (rowIds.length === 0) {
    return;
  }

  const rows = await transaction.query<{ id: string }>(
    directUserOwnership
      ? `
          SELECT id
          FROM core_portfolios
          WHERE id = ANY($1::text[]) AND user_id <> $2
          LIMIT 1
        `
      : `
          SELECT source.id
          FROM ${tableName} AS source
          INNER JOIN core_portfolios AS portfolio ON portfolio.id = source.portfolio_id
          WHERE source.id = ANY($1::text[]) AND portfolio.user_id <> $2
          LIMIT 1
        `,
    [rowIds, userId]
  );

  if (rows.length > 0) {
    throw new Error("Identyfikator danych portfela nalezy do innego uzytkownika.");
  }
};

export const syncPortfolioCoreTablesInTransaction = async (
  transaction: DatabaseTransaction,
  userId: string,
  portfolioBook: PortfolioBook
) => {
  const portfolioIds = portfolioBook.portfolios.map((portfolio) => portfolio.id);
  const portfolioRows = portfolioBook.portfolios.map((portfolio) => ({
    id: portfolio.id,
    user_id: userId,
    name: portfolio.name,
    base_currency: portfolio.baseCurrency ?? "PLN",
    metadata_json: stringifyMetadata(portfolio.metadata),
    created_at: portfolio.createdAt,
    updated_at: portfolio.updatedAt,
  }));
  const accountIds = new Set<string>();
  const instrumentIds = new Set<string>();

  portfolioBook.portfolios.forEach((portfolio) => {
    (portfolio.accounts ?? []).forEach((account) => accountIds.add(account.id));
    (portfolio.instruments ?? []).forEach((instrument) => instrumentIds.add(instrument.id));
  });

  const subPortfolioRows = portfolioBook.portfolios.flatMap((portfolio) =>
    (portfolio.subPortfolios ?? []).map((subPortfolio) => ({
      id: subPortfolio.id,
      portfolio_id: portfolio.id,
      name: subPortfolio.name,
      currency: subPortfolio.currency,
      metadata_json: stringifyMetadata(subPortfolio.metadata),
      created_at: subPortfolio.createdAt,
      updated_at: subPortfolio.updatedAt,
    }))
  );
  const accountRows = portfolioBook.portfolios.flatMap((portfolio) => {
    const activeAccountIds = new Set((portfolio.accounts ?? []).map((account) => account.id));

    return (portfolio.accounts ?? []).map((account) => ({
      id: account.id,
      portfolio_id: portfolio.id,
      parent_account_id:
        account.parentAccountId && activeAccountIds.has(account.parentAccountId)
          ? account.parentAccountId
          : null,
      name: account.name,
      kind: account.kind,
      broker: account.broker ?? null,
      currency: account.currency,
      is_default: account.isDefault,
      metadata_json: stringifyMetadata(account.metadata),
      created_at: account.createdAt,
      updated_at: account.updatedAt,
    }));
  });
  const instrumentRows = portfolioBook.portfolios.flatMap((portfolio) =>
    (portfolio.instruments ?? []).map((instrument) => ({
      id: instrument.id,
      portfolio_id: portfolio.id,
      type: instrument.type,
      asset_kind: instrument.assetKind ?? null,
      symbol: instrument.symbol,
      name: instrument.name,
      market_currency: instrument.marketCurrency,
      provider: instrument.provider ?? null,
      provider_id: instrument.providerId ?? null,
      isin: instrument.isin ?? null,
      price_scale: instrument.priceScale ?? null,
      metadata_json: stringifyMetadata({
        ...instrument.metadata,
        ...(instrument.instrumentIdentity
          ? { instrumentIdentity: instrument.instrumentIdentity }
          : {}),
      }),
      created_at: instrument.createdAt,
      updated_at: instrument.updatedAt,
    }))
  );
  const operationRows = portfolioBook.portfolios.flatMap((portfolio) =>
    (portfolio.operations ?? [])
      .filter((operation) => accountIds.has(operation.accountId))
      .map((operation) => ({
        id: operation.id,
        portfolio_id: portfolio.id,
        account_id: operation.accountId,
        asset_id: operation.assetId && instrumentIds.has(operation.assetId)
          ? operation.assetId
          : null,
        operation_type: operation.operationType,
        quantity: operation.quantity,
        price: operation.price,
        currency: operation.currency,
        exchange_rate: operation.exchangeRate,
        fee: operation.fee,
        tax: operation.tax,
        amount: operation.amount,
        date: operation.date,
        notes: operation.notes,
        metadata_json: stringifyMetadata(operation.metadata),
        created_at: operation.createdAt,
        updated_at: operation.updatedAt,
      }))
  );
  const tagRows = portfolioBook.portfolios.flatMap((portfolio) =>
    (portfolio.tags ?? []).map((tag) => ({
      id: tag.id,
      portfolio_id: portfolio.id,
      name: tag.name,
      color: tag.color,
      created_at: tag.createdAt,
      updated_at: tag.updatedAt,
    }))
  );
  const tagIds = new Set(tagRows.map((tag) => tag.id));
  const tagAssignmentRows = portfolioBook.portfolios.flatMap((portfolio) =>
    (portfolio.tagAssignments ?? [])
      .filter((assignment) => tagIds.has(assignment.tagId))
      .map((assignment) => ({
        id: assignment.id,
        portfolio_id: portfolio.id,
        tag_id: assignment.tagId,
        target_type: assignment.targetType,
        target_id: assignment.targetId,
        created_at: assignment.createdAt,
      }))
  );
  const benchmarkRows = portfolioBook.portfolios.flatMap((portfolio) =>
    (portfolio.benchmarks ?? []).map((benchmark) => ({
      id: benchmark.id,
      portfolio_id: portfolio.id,
      name: benchmark.name,
      symbol: benchmark.symbol,
      kind: benchmark.kind,
      market_currency: benchmark.marketCurrency,
      provider: benchmark.provider,
      provider_id: benchmark.providerId ?? null,
      price_scale: benchmark.priceScale ?? null,
      metadata_json: "{}",
      created_at: portfolio.updatedAt,
      updated_at: portfolio.updatedAt,
    }))
  );

  await assertRowsBelongToUser(transaction, userId, "core_portfolios", portfolioIds, true);
  await assertRowsBelongToUser(
    transaction,
    userId,
    "core_sub_portfolios",
    subPortfolioRows.map((row) => String(row.id))
  );
  await assertRowsBelongToUser(
    transaction,
    userId,
    "core_accounts",
    accountRows.map((row) => String(row.id))
  );
  await assertRowsBelongToUser(
    transaction,
    userId,
    "core_instruments",
    instrumentRows.map((row) => String(row.id))
  );
  await assertRowsBelongToUser(
    transaction,
    userId,
    "core_operations",
    operationRows.map((row) => String(row.id))
  );
  await assertRowsBelongToUser(
    transaction,
    userId,
    "core_tags",
    tagRows.map((row) => String(row.id))
  );
  await assertRowsBelongToUser(
    transaction,
    userId,
    "core_tag_assignments",
    tagAssignmentRows.map((row) => String(row.id))
  );
  await assertRowsBelongToUser(
    transaction,
    userId,
    "core_benchmarks",
    benchmarkRows.map((row) => String(row.id))
  );

  await transaction.execute(
    `
      INSERT INTO core_portfolios (
        id, user_id, name, base_currency, metadata_json, created_at, updated_at
      )
      SELECT id, user_id, name, base_currency, metadata_json, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        user_id TEXT,
        name TEXT,
        base_currency TEXT,
        metadata_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        base_currency = EXCLUDED.base_currency,
        metadata_json = EXCLUDED.metadata_json,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [serializeRows(portfolioRows)]
  );

  await transaction.execute(
    `
      INSERT INTO core_sub_portfolios (
        id, portfolio_id, name, currency, metadata_json, created_at, updated_at
      )
      SELECT id, portfolio_id, name, currency, metadata_json, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        portfolio_id TEXT,
        name TEXT,
        currency TEXT,
        metadata_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        portfolio_id = EXCLUDED.portfolio_id,
        name = EXCLUDED.name,
        currency = EXCLUDED.currency,
        metadata_json = EXCLUDED.metadata_json,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [serializeRows(subPortfolioRows)]
  );

  await transaction.execute(
    `
      INSERT INTO core_accounts (
        id, portfolio_id, parent_account_id, name, kind, broker, currency,
        is_default, metadata_json, created_at, updated_at
      )
      SELECT
        id, portfolio_id, parent_account_id, name, kind, broker, currency,
        is_default, metadata_json, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        portfolio_id TEXT,
        parent_account_id TEXT,
        name TEXT,
        kind TEXT,
        broker TEXT,
        currency TEXT,
        is_default BOOLEAN,
        metadata_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        portfolio_id = EXCLUDED.portfolio_id,
        parent_account_id = EXCLUDED.parent_account_id,
        name = EXCLUDED.name,
        kind = EXCLUDED.kind,
        broker = EXCLUDED.broker,
        currency = EXCLUDED.currency,
        is_default = EXCLUDED.is_default,
        metadata_json = EXCLUDED.metadata_json,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [serializeRows(accountRows)]
  );

  await transaction.execute(
    `
      INSERT INTO core_instruments (
        id, portfolio_id, type, asset_kind, symbol, name, market_currency,
        provider, provider_id, isin, price_scale, metadata_json, created_at, updated_at
      )
      SELECT
        id, portfolio_id, type, asset_kind, symbol, name, market_currency,
        provider, provider_id, isin, price_scale, metadata_json, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        portfolio_id TEXT,
        type TEXT,
        asset_kind TEXT,
        symbol TEXT,
        name TEXT,
        market_currency TEXT,
        provider TEXT,
        provider_id TEXT,
        isin TEXT,
        price_scale DOUBLE PRECISION,
        metadata_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        portfolio_id = EXCLUDED.portfolio_id,
        type = EXCLUDED.type,
        asset_kind = EXCLUDED.asset_kind,
        symbol = EXCLUDED.symbol,
        name = EXCLUDED.name,
        market_currency = EXCLUDED.market_currency,
        provider = EXCLUDED.provider,
        provider_id = EXCLUDED.provider_id,
        isin = EXCLUDED.isin,
        price_scale = EXCLUDED.price_scale,
        metadata_json = EXCLUDED.metadata_json,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [serializeRows(instrumentRows)]
  );

  await transaction.execute(
    `
      INSERT INTO core_tags (
        id, portfolio_id, name, color, created_at, updated_at
      )
      SELECT id, portfolio_id, name, color, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        portfolio_id TEXT,
        name TEXT,
        color TEXT,
        created_at TEXT,
        updated_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        portfolio_id = EXCLUDED.portfolio_id,
        name = EXCLUDED.name,
        color = EXCLUDED.color,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [serializeRows(tagRows)]
  );

  await transaction.execute(
    `
      INSERT INTO core_operations (
        id, portfolio_id, account_id, asset_id, operation_type, quantity, price,
        currency, exchange_rate, fee, tax, amount, date, notes, metadata_json,
        created_at, updated_at
      )
      SELECT
        id, portfolio_id, account_id, asset_id, operation_type, quantity, price,
        currency, exchange_rate, fee, tax, amount, date, notes, metadata_json,
        created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        portfolio_id TEXT,
        account_id TEXT,
        asset_id TEXT,
        operation_type TEXT,
        quantity DOUBLE PRECISION,
        price DOUBLE PRECISION,
        currency TEXT,
        exchange_rate DOUBLE PRECISION,
        fee DOUBLE PRECISION,
        tax DOUBLE PRECISION,
        amount DOUBLE PRECISION,
        date TEXT,
        notes TEXT,
        metadata_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        portfolio_id = EXCLUDED.portfolio_id,
        account_id = EXCLUDED.account_id,
        asset_id = EXCLUDED.asset_id,
        operation_type = EXCLUDED.operation_type,
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        currency = EXCLUDED.currency,
        exchange_rate = EXCLUDED.exchange_rate,
        fee = EXCLUDED.fee,
        tax = EXCLUDED.tax,
        amount = EXCLUDED.amount,
        date = EXCLUDED.date,
        notes = EXCLUDED.notes,
        metadata_json = EXCLUDED.metadata_json,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [serializeRows(operationRows)]
  );

  await transaction.execute(
    `
      INSERT INTO core_tag_assignments (
        id, portfolio_id, tag_id, target_type, target_id, created_at
      )
      SELECT id, portfolio_id, tag_id, target_type, target_id, created_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        portfolio_id TEXT,
        tag_id TEXT,
        target_type TEXT,
        target_id TEXT,
        created_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        portfolio_id = EXCLUDED.portfolio_id,
        tag_id = EXCLUDED.tag_id,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        created_at = EXCLUDED.created_at
    `,
    [serializeRows(tagAssignmentRows)]
  );

  await transaction.execute(
    `
      INSERT INTO core_benchmarks (
        id, portfolio_id, name, symbol, kind, market_currency, provider,
        provider_id, price_scale, metadata_json, created_at, updated_at
      )
      SELECT
        id, portfolio_id, name, symbol, kind, market_currency, provider,
        provider_id, price_scale, metadata_json, created_at, updated_at
      FROM jsonb_to_recordset($1::jsonb) AS input(
        id TEXT,
        portfolio_id TEXT,
        name TEXT,
        symbol TEXT,
        kind TEXT,
        market_currency TEXT,
        provider TEXT,
        provider_id TEXT,
        price_scale DOUBLE PRECISION,
        metadata_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
      ON CONFLICT (id) DO UPDATE SET
        portfolio_id = EXCLUDED.portfolio_id,
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        kind = EXCLUDED.kind,
        market_currency = EXCLUDED.market_currency,
        provider = EXCLUDED.provider,
        provider_id = EXCLUDED.provider_id,
        price_scale = EXCLUDED.price_scale,
        metadata_json = EXCLUDED.metadata_json,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
    `,
    [serializeRows(benchmarkRows)]
  );

  await transaction.execute(
    "DELETE FROM core_tag_assignments WHERE portfolio_id = ANY($1::text[]) AND NOT (id = ANY($2::text[]))",
    [portfolioIds, tagAssignmentRows.map((row) => String(row.id))]
  );
  await transaction.execute(
    "DELETE FROM core_operations WHERE portfolio_id = ANY($1::text[]) AND NOT (id = ANY($2::text[]))",
    [portfolioIds, operationRows.map((row) => String(row.id))]
  );
  await transaction.execute(
    "DELETE FROM core_accounts WHERE portfolio_id = ANY($1::text[]) AND NOT (id = ANY($2::text[]))",
    [portfolioIds, accountRows.map((row) => String(row.id))]
  );
  await transaction.execute(
    "DELETE FROM core_instruments WHERE portfolio_id = ANY($1::text[]) AND NOT (id = ANY($2::text[]))",
    [portfolioIds, instrumentRows.map((row) => String(row.id))]
  );
  await transaction.execute(
    "DELETE FROM core_tags WHERE portfolio_id = ANY($1::text[]) AND NOT (id = ANY($2::text[]))",
    [portfolioIds, tagRows.map((row) => String(row.id))]
  );
  await transaction.execute(
    "DELETE FROM core_sub_portfolios WHERE portfolio_id = ANY($1::text[]) AND NOT (id = ANY($2::text[]))",
    [portfolioIds, subPortfolioRows.map((row) => String(row.id))]
  );
  await transaction.execute(
    "DELETE FROM core_benchmarks WHERE portfolio_id = ANY($1::text[]) AND NOT (id = ANY($2::text[]))",
    [portfolioIds, benchmarkRows.map((row) => String(row.id))]
  );
  await transaction.execute(
    "DELETE FROM core_portfolios WHERE user_id = $1 AND NOT (id = ANY($2::text[]))",
    [userId, portfolioIds]
  );
  await transaction.execute(
    "DELETE FROM portfolio_engine_cache WHERE portfolio_id = ANY($1::text[])",
    [portfolioIds]
  );
};

export const syncPortfolioCoreTables = async (
  userId: string,
  portfolioBook: PortfolioBook
) => {
  await withTransaction((transaction) =>
    syncPortfolioCoreTablesInTransaction(transaction, userId, portfolioBook)
  );
};
