import { getDefaultProviderForKind, inferCurrencyFromSymbol, isGpwSymbol, normalizeGpwSymbol, normalizeSymbol } from "@/lib/ticker";
import { normalizeText, round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type { AssetKind, CurrencyCode, QuoteProvider } from "@/types/portfolio";

export type BrokerImportPreset = "auto" | "xtb" | "degiro" | "ibkr" | "mbank" | "etoro" | "trading212" | "generic";

export type BrokerOperationSide = "buy" | "sell";

export type ImportedBrokerOperation = {
  rowNumber: number;
  side: BrokerOperationSide;
  date: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  quantity: number;
  price: number;
  currency: CurrencyCode;
  feePln: number;
  provider: QuoteProvider;
  providerId?: string;
  warnings: string[];
};

export type BrokerImportParseResult = {
  operations: ImportedBrokerOperation[];
  skippedRows: Array<{
    rowNumber: number;
    reason: string;
  }>;
};

const HEADER_ALIASES = {
  side: ["typ", "rodzaj", "operacja", "transakcja", "transaction type", "type", "side", "action"],
  date: ["data", "data transakcji", "data zawarcia", "czas", "date", "trade date", "time"],
  symbol: ["symbol", "ticker", "instrument", "isin", "kod", "product", "security"],
  name: ["nazwa", "nazwa instrumentu", "instrument name", "name", "opis", "description"],
  quantity: ["ilosc", "liczba", "wolumen", "quantity", "shares", "units", "amount"],
  price: ["cena", "cena transakcji", "kurs", "price", "rate", "unit price"],
  currency: ["waluta", "waluta ceny", "currency", "price currency", "ccy"],
  fee: ["prowizja", "oplata", "oplaty", "koszty", "fee", "fees", "commission"],
  kind: ["klasa", "typ aktywa", "asset type", "category", "market"],
} satisfies Record<string, string[]>;

const CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "DOT", "LINK", "LTC", "BCH", "AVAX", "MATIC"]);

const normalizeHeader = (value: string) => normalizeText(value).replace(/\s+/g, " ");

const getDelimiter = (line: string) => {
  const candidates = [";", ",", "\t"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: line.split(delimiter).length,
    }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
};

const parseCsvLine = (line: string, delimiter: string) => {
  const cells: string[] = [];
  let current = "";
  let isQuoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === "\"" && nextChar === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      isQuoted = !isQuoted;
      continue;
    }

    if (char === delimiter && !isQuoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const parseNumber = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) return null;

  const isNegative = /^\(.+\)$/.test(trimmed) || /-$/.test(trimmed);
  const numeric = trimmed
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/^-/, "")
    .replace(/-$/, "");
  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  let normalized = numeric;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    normalized = numeric
      .replaceAll(thousandSeparator, "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = numeric.replaceAll(".", "").replace(",", ".");
  } else {
    normalized = numeric.replaceAll(",", "");
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) return null;

  return isNegative ? -parsed : parsed;
};

const parseDate = (value: string) => {
  const trimmed = value.trim();
  const europeanDate = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);

  if (europeanDate) {
    const [, day, month, year] = europeanDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return toDateInputValue(trimmed, "");
};

const getCell = (
  row: Record<string, string>,
  aliases: readonly string[],
  fallback = ""
) => {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return fallback;
};

const inferSide = (value: string): BrokerOperationSide | null => {
  const normalized = normalizeHeader(value);

  if (/\b(kupno|zakup|buy|bought|open|otwarcie)\b/.test(normalized)) return "buy";
  if (/\b(sprzedaz|sprzedaz|sell|sold|close|zamkniecie)\b/.test(normalized)) return "sell";

  return null;
};

const inferKind = (value: string, symbol: string, name: string): AssetKind => {
  const normalized = normalizeHeader(`${value} ${symbol} ${name}`);
  const normalizedSymbol = normalizeSymbol(symbol).replace(/[-/].+$/, "");

  if (normalized.includes("crypto") || CRYPTO_SYMBOLS.has(normalizedSymbol)) return "crypto";
  if (normalized.includes("etf")) return "etf";
  return "stock";
};

const getProvider = (kind: AssetKind, symbol: string, currency: CurrencyCode): QuoteProvider => {
  if (kind === "stock" && (currency === "PLN" || isGpwSymbol(symbol))) return "stooq";
  return getDefaultProviderForKind(kind);
};

const normalizeImportedSymbol = (symbol: string, kind: AssetKind, currency: CurrencyCode) => {
  const normalized = normalizeSymbol(symbol).replace(/[-/](USD|EUR|PLN|GBP|CHF)$/i, "");

  if (kind === "stock" && currency === "PLN" && normalized && !normalized.includes(".")) {
    return normalizeGpwSymbol(normalized);
  }

  return normalized;
};

export const parseBrokerOperationsCsv = (
  text: string,
  _preset: BrokerImportPreset = "auto"
): BrokerImportParseResult => {
  void _preset;

  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (lines.length < 2) {
    return {
      operations: [],
      skippedRows: [{ rowNumber: 1, reason: "Plik nie ma naglowka i wierszy transakcji." }],
    };
  }

  const delimiter = getDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const operations: ImportedBrokerOperation[] = [];
  const skippedRows: BrokerImportParseResult["skippedRows"] = [];

  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2;
    const values = parseCsvLine(line, delimiter);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? ""]));
    const side = inferSide(getCell(row, HEADER_ALIASES.side));
    const rawSymbol = getCell(row, HEADER_ALIASES.symbol);
    const rawName = getCell(row, HEADER_ALIASES.name, rawSymbol);
    const rawDate = parseDate(getCell(row, HEADER_ALIASES.date));
    const quantity = parseNumber(getCell(row, HEADER_ALIASES.quantity));
    const price = parseNumber(getCell(row, HEADER_ALIASES.price));
    const currency = toCurrencyCode(
      getCell(row, HEADER_ALIASES.currency) || inferCurrencyFromSymbol(rawSymbol, "USD")
    );
    const fee = parseNumber(getCell(row, HEADER_ALIASES.fee)) ?? 0;
    const kind = inferKind(getCell(row, HEADER_ALIASES.kind), rawSymbol, rawName);
    const symbol = normalizeImportedSymbol(rawSymbol, kind, currency);

    if (!side || !rawDate || !symbol || !quantity || quantity <= 0 || !price || price <= 0) {
      skippedRows.push({
        rowNumber,
        reason: "Brakuje typu, daty, symbolu, ilosci albo ceny.",
      });
      return;
    }

    const provider = getProvider(kind, symbol, currency);

    operations.push({
      rowNumber,
      side,
      date: rawDate,
      symbol,
      name: rawName || symbol,
      kind,
      quantity: round(Math.abs(quantity), 6),
      price: round(Math.abs(price), 6),
      currency,
      feePln: round(Math.abs(fee), 6),
      provider,
      providerId: provider === "yahoo" || provider === "eodhd" ? symbol : undefined,
      warnings:
        currency !== "PLN" && fee !== 0
          ? ["Prowizja z importu jest zapisana jako PLN. Sprawdz ja, jesli broker eksportuje prowizje w walucie rynku."]
          : [],
    });
  });

  return {
    operations,
    skippedRows,
  };
};
