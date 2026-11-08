export const PRIVACY_EXPORT_VERSION = "1.0.0";
export const PRIVACY_EXPORTER_VERSION = "2.0.0";

export const csvEscapeCell = (value: unknown) => {
  let text = value === null || value === undefined ? "" : String(value);
  // Protect text cells against spreadsheet formula execution while preserving
  // actual numeric values returned as strings by PostgreSQL numeric columns.
  const numericLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
  if (typeof value === "string" && !numericLiteral && /^[\s\uFEFF]*[=+\-@]/u.test(value)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
};

const AUTOMATIC_QUOTE_FIELDS = [
  "latestPrice",
  "priceSource",
  "latestPriceDate",
  "latestPriceMarketTimestamp",
  "latestPriceFetchedAt",
  "previousClose",
] as const;

/**
 * Legacy portfolio snapshots may include provider quote snapshots alongside
 * user-owned positions and transactions. Keep explicit manual prices, but do
 * not redistribute automatic provider quotes as part of a personal export.
 */
export const stripAutomaticQuotesFromLegacyPortfolio = (value: unknown): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const book = value as Record<string, unknown>;
  if (!Array.isArray(book.portfolios)) return value;

  return {
    ...book,
    portfolios: book.portfolios.map((portfolioValue) => {
      if (portfolioValue === null || typeof portfolioValue !== "object" || Array.isArray(portfolioValue)) return portfolioValue;
      const portfolio = portfolioValue as Record<string, unknown>;
      if (!Array.isArray(portfolio.assets)) return portfolio;
      return {
        ...portfolio,
        assets: portfolio.assets.map((assetValue) => {
          if (assetValue === null || typeof assetValue !== "object" || Array.isArray(assetValue)) return assetValue;
          const asset = assetValue as Record<string, unknown>;
          if (asset.priceSource === "MANUAL") return asset;
          const sanitized = { ...asset };
          for (const field of AUTOMATIC_QUOTE_FIELDS) delete sanitized[field];
          return sanitized;
        }),
      };
    }),
  };
};

export const buildOperationsCsv = (rows: Array<Record<string, unknown>>) => {
  const columns = [
    "id", "portfolio_id", "account_id", "asset_id", "operation_type", "quantity",
    "price", "currency", "exchange_rate", "fee", "tax", "amount", "date",
    "notes", "metadata_json", "created_at", "updated_at",
  ];
  const lines = [columns.map(csvEscapeCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscapeCell(row[column])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};

export type ExportFileSummary = { records: number; bytes: number };

export const createExportManifest = (
  createdAt: string,
  options: { exportId?: string; files?: Record<string, ExportFileSummary> } = {}
) => ({
  format: "mexo-user-data-export",
  version: PRIVACY_EXPORT_VERSION,
  schemaVersion: PRIVACY_EXPORT_VERSION,
  exporterVersion: PRIVACY_EXPORTER_VERSION,
  exportId: options.exportId ?? "not-assigned",
  createdAt,
  locale: "pl-PL",
  encoding: "UTF-8",
  scope: "All data belonging to the authenticated account across all owned portfolios.",
  files: Object.entries(options.files ?? {}).map(([path, summary]) => ({ path, ...summary })),
  fileListNote: "manifest.json describes the other archive files; its own size is excluded to avoid a self-referential manifest.",
  numericValues: "JSON preserves stored values; CSV uses decimal text and does not round financial values.",
  currencies: "Each operation and instrument retains its original stored currency; no conversion is applied by this export.",
  exclusions: [
    "Password hashes, session/reset/verification tokens, OAuth access/refresh tokens and calendar feed token values.",
    "Derived portfolio caches and automatic market-data quote snapshots.",
    "Shared market, corporate-event and ESPI data not owned by this account.",
  ],
});

export const parseStoredJson = (value: string, field: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { _exportWarning: `Stored ${field} was not valid JSON; original text retained.`, raw: value };
  }
};
