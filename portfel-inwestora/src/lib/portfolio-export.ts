import { getAggregateOperationTypeLabel, type AggregateOperationRow } from "@/lib/aggregate-operations";
import type { InvestmentPortfolio } from "@/types/portfolio";

/**
 * Two ways to take data out of Mexo:
 * - the operations history as CSV for a spreadsheet (semicolons and decimal commas, as Polish
 *   Excel expects, with a byte order mark so Polish letters survive);
 * - a backup of one portfolio as JSON, which keeps everything (lots, sales with their FIFO
 *   allocations, accounts, operations) and can be restored as a new portfolio.
 */

const CSV_SEPARATOR = ";";

const formatCsvNumber = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Math.round(value * 1e8) / 1e8).replace(".", ",");
};

const escapeCsv = (value: string) => (/[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const OPERATIONS_CSV_HEADER = [
  "Data", "Portfel", "Typ operacji", "Instrument", "Symbol", "Ilość", "Cena", "Waluta", "Kwota",
  "Prowizja", "Podatek", "Konto", "Konto docelowe", "Wynik (PLN)", "Notatka",
];

export const buildOperationsCsv = (rows: AggregateOperationRow[]) => {
  const lines = rows.map((row) => {
    const { operation } = row;
    return [
      operation.date,
      row.portfolioName,
      getAggregateOperationTypeLabel(operation),
      row.instrumentName ?? "",
      row.instrumentSymbol ?? "",
      formatCsvNumber(operation.quantity),
      formatCsvNumber(operation.price),
      operation.currency,
      formatCsvNumber(operation.amount),
      formatCsvNumber(operation.fee),
      formatCsvNumber(operation.tax),
      row.accountName ?? "",
      row.targetAccountName ?? "",
      formatCsvNumber(row.resultPln),
      operation.notes ?? "",
    ].map((cell) => escapeCsv(String(cell))).join(CSV_SEPARATOR);
  });
  return `﻿${[OPERATIONS_CSV_HEADER.join(CSV_SEPARATOR), ...lines].join("\r\n")}\r\n`;
};

export const PORTFOLIO_BACKUP_FORMAT = "mexo-portfolio-backup";
export const PORTFOLIO_BACKUP_VERSION = 1;
/** A backup larger than this is not a portfolio export (or is not one Mexo could save). */
export const PORTFOLIO_BACKUP_MAX_BYTES = 8 * 1024 * 1024;

export const buildPortfolioBackup = (portfolio: InvestmentPortfolio, exportedAt = new Date().toISOString()) =>
  JSON.stringify({ format: PORTFOLIO_BACKUP_FORMAT, version: PORTFOLIO_BACKUP_VERSION, exportedAt, portfolio }, null, 2);

/**
 * Reads a backup file and returns the portfolio to add, still to be normalised by the caller.
 * The restored portfolio always gets new ids (see below), so it never clashes with the original.
 * The name gets "(kopia)" when the account already has a portfolio with that name.
 */
export const parsePortfolioBackup = (
  text: string,
  { existingIds, existingNames, createId }: { existingIds: string[]; existingNames: string[]; createId: () => string }
): InvestmentPortfolio => {
  if (new TextEncoder().encode(text).length > PORTFOLIO_BACKUP_MAX_BYTES) {
    throw new Error("Plik jest za duży na kopię portfela.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("To nie jest plik kopii portfela Mexo (nieprawidłowy JSON).");
  }
  const backup = parsed as { format?: unknown; version?: unknown; portfolio?: unknown };
  if (backup?.format !== PORTFOLIO_BACKUP_FORMAT) throw new Error("To nie jest plik kopii portfela Mexo.");
  if (backup.version !== PORTFOLIO_BACKUP_VERSION) throw new Error("Ta kopia pochodzi z innej wersji Mexo i nie da się jej wczytać.");
  const portfolio = backup.portfolio as Partial<InvestmentPortfolio> | undefined;
  if (!portfolio || typeof portfolio !== "object" || typeof portfolio.id !== "string" || !portfolio.id || typeof portfolio.name !== "string") {
    throw new Error("Kopia nie zawiera portfela.");
  }
  if (!Array.isArray(portfolio.assets) || !Array.isArray(portfolio.sales)) throw new Error("Kopia portfela jest niekompletna.");

  // Every id gets a new value: the account stores lots, sales and operations by id, so a copy
  // restored next to its original would clash. The portfolio id is a random token that other ids
  // contain (accounts, instruments), so it is replaced everywhere; the other ids are replaced only
  // where a whole string value equals them, which keeps the links between them intact.
  void existingIds;
  const newId = createId();
  let json = JSON.stringify(portfolio).split(portfolio.id).join(newId);
  const suffix = newId.slice(-6);
  const record = JSON.parse(json) as InvestmentPortfolio;
  const innerIds = new Set<string>();
  const collect = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const id = (item as { id?: unknown })?.id;
      if (typeof id === "string" && id && !id.includes(newId)) innerIds.add(id);
    }
  };
  collect(record.assets);
  collect(record.sales);
  collect(record.realizedAdjustments);
  collect(record.operations);
  collect(record.tags);
  collect(record.tagAssignments);
  collect(record.subPortfolios);
  for (const id of innerIds) json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}-r${suffix}`));
  const result = JSON.parse(json) as InvestmentPortfolio;
  const lowerNames = existingNames.map((name) => name.trim().toLocaleLowerCase("pl-PL"));
  let name = result.name.trim() || "Przywrócony portfel";
  if (lowerNames.includes(name.toLocaleLowerCase("pl-PL"))) {
    let attempt = `${name} (kopia)`;
    for (let index = 2; lowerNames.includes(attempt.toLocaleLowerCase("pl-PL")); index += 1) attempt = `${name} (kopia ${index})`;
    name = attempt;
  }
  return { ...result, name };
};

export const getExportFileDate = (now = new Date()) => now.toISOString().slice(0, 10);

/** A file name without characters that Windows or macOS refuse. */
export const toSafeFileName = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "portfel";
