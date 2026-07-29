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
