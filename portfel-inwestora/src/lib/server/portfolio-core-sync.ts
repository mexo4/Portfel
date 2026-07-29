import { execute } from "@/lib/server/db";
import type { PortfolioBook } from "@/types/portfolio";

const stringifyMetadata = (value: Record<string, unknown> | undefined) =>
  JSON.stringify(value ?? {});

export const syncPortfolioCoreTables = async (
  userId: string,
  portfolioBook: PortfolioBook
) => {
  await execute("DELETE FROM core_portfolios WHERE user_id = $1", [userId]);

  for (const portfolio of portfolioBook.portfolios) {
    await execute(
      `
        INSERT INTO core_portfolios (
          id,
          user_id,
          name,
          base_currency,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          base_currency = EXCLUDED.base_currency,
          metadata_json = EXCLUDED.metadata_json,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        portfolio.id,
        userId,
        portfolio.name,
        portfolio.baseCurrency ?? "PLN",
        stringifyMetadata(portfolio.metadata),
        portfolio.createdAt,
        portfolio.updatedAt,
      ]
    );

    for (const subPortfolio of portfolio.subPortfolios ?? []) {
      await execute(
        `
          INSERT INTO core_sub_portfolios (
            id,
            portfolio_id,
            name,
            currency,
            metadata_json,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            portfolio_id = EXCLUDED.portfolio_id,
            name = EXCLUDED.name,
            currency = EXCLUDED.currency,
            metadata_json = EXCLUDED.metadata_json,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
        `,
        [
          subPortfolio.id,
          portfolio.id,
          subPortfolio.name,
          subPortfolio.currency,
          stringifyMetadata(subPortfolio.metadata),
          subPortfolio.createdAt,
          subPortfolio.updatedAt,
        ]
      );
    }

    for (const account of portfolio.accounts ?? []) {
      await execute(
        `
          INSERT INTO core_accounts (
            id,
            portfolio_id,
            parent_account_id,
            name,
            kind,
            broker,
            currency,
            is_default,
            metadata_json,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        [
          account.id,
          portfolio.id,
          account.parentAccountId ?? null,
          account.name,
          account.kind,
          account.broker ?? null,
          account.currency,
          account.isDefault,
          stringifyMetadata(account.metadata),
          account.createdAt,
          account.updatedAt,
        ]
      );
    }

    for (const instrument of portfolio.instruments ?? []) {
      await execute(
        `
          INSERT INTO core_instruments (
            id,
            portfolio_id,
            type,
            asset_kind,
            symbol,
            name,
            market_currency,
            provider,
            provider_id,
            isin,
            price_scale,
            metadata_json,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        [
          instrument.id,
          portfolio.id,
          instrument.type,
          instrument.assetKind ?? null,
          instrument.symbol,
          instrument.name,
          instrument.marketCurrency,
          instrument.provider ?? null,
          instrument.providerId ?? null,
          instrument.isin ?? null,
          instrument.priceScale ?? null,
          stringifyMetadata(instrument.metadata),
          instrument.createdAt,
          instrument.updatedAt,
        ]
      );
    }

    for (const operation of portfolio.operations ?? []) {
      await execute(
        `
          INSERT INTO core_operations (
            id,
            portfolio_id,
            account_id,
            asset_id,
            operation_type,
            quantity,
            price,
            currency,
            exchange_rate,
            fee,
            tax,
            amount,
            date,
            notes,
            metadata_json,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
        [
          operation.id,
          portfolio.id,
          operation.accountId,
          operation.assetId,
          operation.operationType,
          operation.quantity,
          operation.price,
          operation.currency,
          operation.exchangeRate,
          operation.fee,
          operation.tax,
          operation.amount,
          operation.date,
          operation.notes,
          stringifyMetadata(operation.metadata),
          operation.createdAt,
          operation.updatedAt,
        ]
      );
    }

    for (const tag of portfolio.tags ?? []) {
      await execute(
        `
          INSERT INTO core_tags (
            id,
            portfolio_id,
            name,
            color,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            portfolio_id = EXCLUDED.portfolio_id,
            name = EXCLUDED.name,
            color = EXCLUDED.color,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
        `,
        [tag.id, portfolio.id, tag.name, tag.color, tag.createdAt, tag.updatedAt]
      );
    }

    for (const assignment of portfolio.tagAssignments ?? []) {
      await execute(
        `
          INSERT INTO core_tag_assignments (
            id,
            portfolio_id,
            tag_id,
            target_type,
            target_id,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            portfolio_id = EXCLUDED.portfolio_id,
            tag_id = EXCLUDED.tag_id,
            target_type = EXCLUDED.target_type,
            target_id = EXCLUDED.target_id,
            created_at = EXCLUDED.created_at
        `,
        [
          assignment.id,
          portfolio.id,
          assignment.tagId,
          assignment.targetType,
          assignment.targetId,
          assignment.createdAt,
        ]
      );
    }

    for (const benchmark of portfolio.benchmarks ?? []) {
      const now = new Date().toISOString();

      await execute(
        `
          INSERT INTO core_benchmarks (
            id,
            portfolio_id,
            name,
            symbol,
            kind,
            market_currency,
            provider,
            provider_id,
            price_scale,
            metadata_json,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        [
          benchmark.id,
          portfolio.id,
          benchmark.name,
          benchmark.symbol,
          benchmark.kind,
          benchmark.marketCurrency,
          benchmark.provider,
          benchmark.providerId ?? null,
          benchmark.priceScale ?? null,
          "{}",
          now,
          now,
        ]
      );
    }
  }
};
