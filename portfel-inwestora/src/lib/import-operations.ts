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
  transactionValue?: number;
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
  warnings?: string[];
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

const PDF_LITERAL_PATTERN = /\((?:\\.|[^\\()])*\)/g;
const PDF_HEX_PATTERN = /<([0-9a-fA-F\s]{4,})>/g;
const PDF_DATE_PATTERN =
  /(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/g;
const PDF_NUMBER_PATTERN = /(?<![A-Za-z])[-(]?\d[\d\s.,]*\)?-?(?![A-Za-z])/g;
const PDF_CURRENCY_PATTERN =
  /\b(PLN|USD|EUR|GBP|CHF|CZK|CAD|JPY|NOK|SEK|DKK|HUF|RON)\b/i;
const PDF_SYMBOL_STOP_WORDS = new Set([
  "BUY",
  "SELL",
  "KUPNO",
  "ZAKUP",
  "SPRZEDAZ",
  "TRANSAKCJA",
  "OPERACJA",
  "INSTRUMENT",
  "SYMBOL",
  "TICKER",
  "QUANTITY",
  "ILOSC",
  "PRICE",
  "CENA",
  "VALUE",
  "WARTOSC",
  "FEE",
  "COMMISSION",
  "PROWIZJA",
  "WALUTA",
  "CURRENCY",
  "DATE",
  "DATA",
  "XTB",
  "REPORT",
  "RAPORT",
  "HISTORIA",
]);

const decodePdfLiteral = (value: string) => {
  const body = value.slice(1, -1);
  let decoded = "";

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (char !== "\\") {
      decoded += char;
      continue;
    }

    const nextChar = body[index + 1];

    if (!nextChar) {
      continue;
    }

    if (nextChar === "\r" || nextChar === "\n") {
      if (nextChar === "\r" && body[index + 2] === "\n") {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (/[0-7]/.test(nextChar)) {
      const octal = body.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? "";
      decoded += String.fromCharCode(parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    const escapes: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\",
    };

    decoded += escapes[nextChar] ?? nextChar;
    index += 1;
  }

  return decoded;
};

const decodeUtf16Be = (bytes: number[]) => {
  let decoded = "";

  for (let index = 0; index + 1 < bytes.length; index += 2) {
    decoded += String.fromCharCode(bytes[index] * 256 + bytes[index + 1]);
  }

  return decoded;
};

const decodePdfHexString = (value: string) => {
  const cleanHex = value.replace(/\s/g, "");

  if (!cleanHex || cleanHex.length < 4) {
    return "";
  }

  const evenHex = cleanHex.length % 2 === 0 ? cleanHex : `${cleanHex}0`;
  const bytes: number[] = [];

  for (let index = 0; index < evenHex.length; index += 2) {
    bytes.push(parseInt(evenHex.slice(index, index + 2), 16));
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.slice(2));
  }

  const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(
    new Uint8Array(bytes)
  );
  const replacementCount = (utf8Text.match(/\uFFFD/g) ?? []).length;

  if (replacementCount > Math.max(1, utf8Text.length / 8)) {
    return new TextDecoder("latin1").decode(new Uint8Array(bytes));
  }

  return utf8Text;
};

const getPrintableRatio = (value: string) => {
  if (!value) {
    return 0;
  }

  const printable = value.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u017f]/g, "");
  return printable.length / value.length;
};

const extractTextFromPdfBytes = (bytes: Uint8Array) => {
  const rawText = new TextDecoder("latin1").decode(bytes);
  const textParts: string[] = [];
  const literalMatches = rawText.match(PDF_LITERAL_PATTERN) ?? [];

  literalMatches.forEach((match) => {
    const decoded = decodePdfLiteral(match).trim();

    if (decoded.length >= 2 && getPrintableRatio(decoded) > 0.65) {
      textParts.push(decoded);
    }
  });

  Array.from(rawText.matchAll(PDF_HEX_PATTERN)).forEach((match) => {
    const decoded = decodePdfHexString(match[1]).trim();

    if (decoded.length >= 2 && getPrintableRatio(decoded) > 0.65) {
      textParts.push(decoded);
    }
  });

  const readableRaw = rawText
    .replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u017f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [...textParts, readableRaw].join("\n");
};

const extractLabeledNumber = (text: string, labels: string[]) => {
  for (const label of labels) {
    const pattern = new RegExp(
      `${label}\\s*:?\\s*(${PDF_NUMBER_PATTERN.source})`,
      "i"
    );
    const match = text.match(pattern);
    const value = match?.[1] ? parseNumber(match[1]) : null;

    if (value !== null) {
      return value;
    }
  }

  return null;
};

const extractPdfNumbers = (chunk: string, dateText: string) =>
  Array.from(chunk.replace(dateText, " ").matchAll(PDF_NUMBER_PATTERN))
    .map((match) => parseNumber(match[0]))
    .filter((value): value is number => value !== null && Number.isFinite(value));

const extractPdfSymbol = (chunk: string) => {
  const labeledSymbol = chunk.match(
    /\b(?:symbol|ticker|instrument|isin|walor|kod)\s*:?\s*([A-Z0-9]{1,12}(?:[._-][A-Z0-9]{1,8})?)/i
  )?.[1];

  if (labeledSymbol) {
    return labeledSymbol;
  }

  const isin = chunk.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/)?.[0];

  if (isin) {
    return isin;
  }

  const tokens = chunk.match(/\b[A-Z]{1,6}[A-Z0-9]{0,6}(?:[._-][A-Z0-9]{1,8})?\b/g) ?? [];

  return (
    tokens.find((token) => {
      const normalized = normalizeHeader(token).toUpperCase();

      return (
        !PDF_SYMBOL_STOP_WORDS.has(normalized) &&
        !PDF_CURRENCY_PATTERN.test(token) &&
        !/^\d+$/.test(token)
      );
    }) ?? ""
  );
};

const extractPdfName = (chunk: string, dateText: string, symbol: string) => {
  const sideMatch = chunk.match(
    /\b(kupno|zakup|buy|bought|sprzedaz|sell|sold)\b/i
  );
  const startIndex = chunk.indexOf(dateText) + dateText.length;
  const endIndex =
    typeof sideMatch?.index === "number" && sideMatch.index > startIndex
      ? sideMatch.index
      : chunk.length;
  const candidate = chunk
    .slice(startIndex, endIndex)
    .replace(symbol, "")
    .replace(/\b(?:symbol|ticker|instrument|isin|walor|kod)\b:?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return candidate || symbol;
};

const buildPdfChunks = (text: string) => {
  const compactText = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const dateMatches = Array.from(compactText.matchAll(PDF_DATE_PATTERN));

  return dateMatches
    .map((match, index) => {
      const startIndex = match.index ?? 0;
      const endIndex =
        index + 1 < dateMatches.length
          ? dateMatches[index + 1].index ?? compactText.length
          : compactText.length;

      return compactText.slice(startIndex, endIndex).trim();
    })
    .filter(Boolean);
};

const parseXtbPdfChunk = (
  chunk: string,
  rowNumber: number
): ImportedBrokerOperation | null => {
  const dateMatch = chunk.match(PDF_DATE_PATTERN);
  const dateText = dateMatch?.[0] ?? "";
  const rawDate = parseDate(dateText);
  const side = inferSide(chunk);
  const rawSymbol = extractPdfSymbol(chunk);
  const currency = toCurrencyCode(
    chunk.match(PDF_CURRENCY_PATTERN)?.[1] || inferCurrencyFromSymbol(rawSymbol, "USD")
  );
  const kind = inferKind(chunk, rawSymbol, rawSymbol);
  const symbol = normalizeImportedSymbol(rawSymbol, kind, currency);
  const numbers = extractPdfNumbers(chunk, dateText).map(Math.abs);
  const quantity =
    extractLabeledNumber(chunk, ["ilosc", "liczba", "wolumen", "quantity", "shares", "units"]) ??
    numbers[0] ??
    null;
  const price =
    extractLabeledNumber(chunk, ["cena", "kurs", "price", "rate", "unit price"]) ??
    numbers[1] ??
    null;
  const fee =
    extractLabeledNumber(chunk, ["prowizja", "commission", "fee", "oplata", "koszt"]) ?? 0;
  const transactionValue =
    extractLabeledNumber(chunk, ["wartosc transakcji", "wartosc", "value", "amount", "kwota"]) ??
    (quantity && price ? quantity * price : undefined);

  if (!side || !rawDate || !symbol || !quantity || quantity <= 0 || !price || price <= 0) {
    return null;
  }

  const provider = getProvider(kind, symbol, currency);
  const name = extractPdfName(chunk, dateText, rawSymbol);

  return {
    rowNumber,
    side,
    date: rawDate,
    symbol,
    name,
    kind,
    quantity: round(Math.abs(quantity), 6),
    price: round(Math.abs(price), 6),
    currency,
    feePln: round(Math.abs(fee), 6),
    transactionValue:
      typeof transactionValue === "number" && Number.isFinite(transactionValue)
        ? round(Math.abs(transactionValue), 6)
        : undefined,
    provider,
    providerId: provider === "yahoo" || provider === "eodhd" ? symbol : undefined,
    warnings: [
      "PDF XTB zostal odczytany heurystycznie. Sprawdz ilosc, cene, prowizje i walute przed importem.",
    ],
  };
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

export const parseBrokerOperationsPdf = (
  bytes: Uint8Array,
  _preset: BrokerImportPreset = "xtb"
): BrokerImportParseResult => {
  void _preset;

  const extractedText = extractTextFromPdfBytes(bytes);
  const chunks = buildPdfChunks(extractedText);
  const operations: ImportedBrokerOperation[] = [];
  const skippedRows: BrokerImportParseResult["skippedRows"] = [];
  const warnings = [
    "Import PDF XTB dziala dla raportow z warstwa tekstowa. Skan lub mocno zmieniony uklad PDF moze wymagac eksportu CSV/Excel z platformy XTB.",
  ];

  if (chunks.length === 0) {
    return {
      operations: [],
      skippedRows: [
        {
          rowNumber: 1,
          reason: "Nie znaleziono dat transakcji ani warstwy tekstowej w PDF.",
        },
      ],
      warnings,
    };
  }

  chunks.forEach((chunk, index) => {
    const rowNumber = index + 1;
    const operation = parseXtbPdfChunk(chunk, rowNumber);

    if (operation) {
      operations.push(operation);
      return;
    }

    if (inferSide(chunk)) {
      skippedRows.push({
        rowNumber,
        reason: "Nie udalo sie jednoznacznie odczytac symbolu, ilosci albo ceny z PDF.",
      });
    }
  });

  if (operations.length === 0 && skippedRows.length === 0) {
    skippedRows.push({
      rowNumber: 1,
      reason: "PDF nie zawiera rozpoznanych operacji kupna lub sprzedazy.",
    });
  }

  return {
    operations,
    skippedRows,
    warnings,
  };
};
