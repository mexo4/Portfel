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
  side: [
    "typ",
    "rodzaj",
    "operacja",
    "transakcja",
    "transaction type",
    "type",
    "side",
    "action",
    "buy sell",
    "k s",
  ],
  date: [
    "data",
    "data transakcji",
    "data zawarcia",
    "data otwarcia",
    "data realizacji",
    "czas",
    "date",
    "trade date",
    "time",
    "open time",
    "execution time",
  ],
  symbol: [
    "symbol",
    "ticker",
    "instrument",
    "isin",
    "kod",
    "walor",
    "product",
    "security",
    "market",
  ],
  name: ["nazwa", "nazwa instrumentu", "instrument name", "name", "opis", "description"],
  quantity: [
    "ilosc",
    "liczba",
    "wolumen",
    "quantity",
    "shares",
    "units",
    "amount",
    "volume",
  ],
  price: ["cena", "cena transakcji", "kurs", "price", "rate", "unit price", "open price"],
  currency: ["waluta", "waluta ceny", "currency", "price currency", "ccy"],
  fee: ["prowizja", "oplata", "oplaty", "koszty", "fee", "fees", "commission"],
  kind: ["klasa", "typ aktywa", "asset type", "category", "market"],
  value: [
    "wartosc",
    "wartosc transakcji",
    "kwota",
    "nominal",
    "nominal value",
    "transaction value",
    "value",
    "gross value",
    "net value",
  ],
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
  const excelSerialDate = Number(trimmed.replace(",", "."));

  if (europeanDate) {
    const [, day, month, year] = europeanDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  if (
    Number.isFinite(excelSerialDate) &&
    excelSerialDate >= 20_000 &&
    excelSerialDate <= 80_000
  ) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.floor(excelSerialDate) * 86_400_000)
      .toISOString()
      .slice(0, 10);
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

  if (normalized === "k" || normalized === "b") return "buy";
  if (normalized === "s") return "sell";
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

const countHeaderMatches = (cells: string[]) => {
  const normalizedCells = new Set(cells.map(normalizeHeader).filter(Boolean));

  return Object.values(HEADER_ALIASES).reduce(
    (total, aliases) =>
      total +
      (aliases.some((alias) => normalizedCells.has(normalizeHeader(alias))) ? 1 : 0),
    0
  );
};

const findHeaderRowIndex = (rows: string[][]) => {
  const candidates = rows.slice(0, 30).map((row, index) => ({
    index,
    score: countHeaderMatches(row),
  }));
  const bestCandidate = candidates.sort((left, right) => right.score - left.score)[0];

  return bestCandidate && bestCandidate.score >= 3 ? bestCandidate.index : 0;
};

const getFirstSymbolCandidate = (value: string) =>
  value.match(/\b[A-Z]{1,6}[A-Z0-9]{0,6}(?:[._-][A-Z0-9]{1,8})?\b/)?.[0] ?? value;

const parseBrokerOperationRows = (
  rows: string[][],
  warnings: string[] = []
): BrokerImportParseResult => {
  const cleanedRows = rows
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));

  if (cleanedRows.length < 2) {
    return {
      operations: [],
      skippedRows: [{ rowNumber: 1, reason: "Plik nie ma naglowka i wierszy transakcji." }],
      warnings,
    };
  }

  const headerRowIndex = findHeaderRowIndex(cleanedRows);
  const headers = cleanedRows[headerRowIndex].map(normalizeHeader);
  const operations: ImportedBrokerOperation[] = [];
  const skippedRows: BrokerImportParseResult["skippedRows"] = [];

  cleanedRows.slice(headerRowIndex + 1).forEach((values, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const row = Object.fromEntries(
      headers.map((header, cellIndex) => [header, values[cellIndex] ?? ""])
    );
    const side = inferSide(getCell(row, HEADER_ALIASES.side));
    const rawSymbolSource = getCell(row, HEADER_ALIASES.symbol);
    const rawName = getCell(row, HEADER_ALIASES.name, rawSymbolSource);
    const rawSymbol = getFirstSymbolCandidate(rawSymbolSource || rawName);
    const rawDate = parseDate(getCell(row, HEADER_ALIASES.date));
    const quantity = parseNumber(getCell(row, HEADER_ALIASES.quantity));
    const transactionValue = parseNumber(getCell(row, HEADER_ALIASES.value));
    const rawPrice = parseNumber(getCell(row, HEADER_ALIASES.price));
    const price =
      rawPrice ??
      (quantity && transactionValue ? Math.abs(transactionValue) / Math.abs(quantity) : null);
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
      transactionValue:
        typeof transactionValue === "number" && Number.isFinite(transactionValue)
          ? round(Math.abs(transactionValue), 6)
          : undefined,
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
    warnings,
  };
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

const getPdfTextPartsFromRawText = (rawText: string) => {
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

  return [...textParts, readableRaw];
};

const extractPdfFlateStreams = (rawText: string) =>
  Array.from(
    rawText.matchAll(
      /<<(?:.|\r|\n){0,1800}?\/FlateDecode(?:.|\r|\n){0,800}?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g
    )
  ).map((match) => {
    const binary = match[1];
    const streamBytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      streamBytes[index] = binary.charCodeAt(index) & 0xff;
    }

    return streamBytes;
  });

const extractTextFromPdfBytes = async (bytes: Uint8Array) => {
  const rawText = new TextDecoder("latin1").decode(bytes);
  const textParts = getPdfTextPartsFromRawText(rawText);
  const flateStreams = extractPdfFlateStreams(rawText);

  for (const streamBytes of flateStreams) {
    const inflated = await inflatePdfBytes(streamBytes);

    if (!inflated) {
      continue;
    }

    textParts.push(
      ...getPdfTextPartsFromRawText(new TextDecoder("latin1").decode(inflated))
    );
  }

  return textParts.join("\n");
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
  const lineChunks = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && line.match(PDF_DATE_PATTERN) && inferSide(line));
  const compactText = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const dateMatches = Array.from(compactText.matchAll(PDF_DATE_PATTERN));

  const dateChunks = dateMatches
    .map((match, index) => {
      const startIndex = match.index ?? 0;
      const endIndex =
        index + 1 < dateMatches.length
          ? dateMatches[index + 1].index ?? compactText.length
          : compactText.length;

      return compactText.slice(startIndex, endIndex).trim();
    })
    .filter(Boolean);

  return Array.from(new Set([...lineChunks, ...dateChunks]));
};

const inferPdfMoneyFields = ({
  numbers,
  quantity,
  price,
  labeledFee,
  labeledTransactionValue,
}: {
  numbers: number[];
  quantity: number | null;
  price: number | null;
  labeledFee: number | null;
  labeledTransactionValue: number | null;
}) => {
  const expectedValue =
    quantity && price && quantity > 0 && price > 0 ? Math.abs(quantity * price) : null;
  const candidateNumbers = numbers
    .map(Math.abs)
    .filter((value) => value > 0)
    .filter((value) => value !== Math.abs(quantity ?? 0) && value !== Math.abs(price ?? 0));
  const transactionValue =
    labeledTransactionValue ??
    (expectedValue
      ? candidateNumbers.find(
          (value) => Math.abs(value - expectedValue) <= Math.max(0.05, expectedValue * 0.02)
        ) ?? expectedValue
      : undefined);
  const fee =
    labeledFee ??
    candidateNumbers
      .filter(
        (value) =>
          value !== transactionValue &&
          (!transactionValue || value <= Math.max(100, transactionValue * 0.05))
      )
      .sort((left, right) => left - right)[0] ??
    0;

  return {
    fee,
    transactionValue,
  };
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
  const inferredMoneyFields = inferPdfMoneyFields({
    numbers,
    quantity,
    price,
    labeledFee: extractLabeledNumber(chunk, ["prowizja", "commission", "fee", "oplata", "koszt"]),
    labeledTransactionValue: extractLabeledNumber(chunk, [
      "wartosc transakcji",
      "wartosc",
      "value",
      "amount",
      "kwota",
    ]),
  });
  const fee = inferredMoneyFields.fee;
  const transactionValue = inferredMoneyFields.transactionValue;

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

  const delimiter = getDelimiter(lines[0]);
  return parseBrokerOperationRows(lines.map((line) => parseCsvLine(line, delimiter)));
};

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

type WorkbookWorksheetEntry = {
  entry: ZipEntry;
  order: number;
  sheetName: string;
};

const textDecoder = new TextDecoder("utf-8", { fatal: false });

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const yieldToMainThread = () =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

const readZipString = (bytes: Uint8Array, offset: number, length: number) =>
  textDecoder.decode(bytes.slice(offset, offset + length));

const findEndOfCentralDirectory = (view: DataView) => {
  const minimumOffset = Math.max(0, view.byteLength - 65_557);

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }

  return -1;
};

const readZipCentralDirectory = (bytes: Uint8Array): ZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);

  if (eocdOffset < 0) {
    throw new Error("Nie znaleziono struktury ZIP w pliku XLSX.");
  }

  const entriesCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entriesCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = readZipString(bytes, offset + 46, fileNameLength).replace(/\\/g, "/");

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
};

const inflateRawBytes = async (bytes: Uint8Array) => {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Ta przegladarka nie wspiera rozpakowywania XLSX.");
  }

  const stream = new Blob([toArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));

  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const inflatePdfBytes = async (bytes: Uint8Array) => {
  if (typeof DecompressionStream === "undefined") {
    return null;
  }

  for (const format of ["deflate", "deflate-raw"] as CompressionFormat[]) {
    try {
      const stream = new Blob([toArrayBuffer(bytes)])
        .stream()
        .pipeThrough(new DecompressionStream(format));

      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Try the next PDF deflate framing variant.
    }
  }

  return null;
};

const readZipEntryBytes = async (
  bytes: Uint8Array,
  entry: ZipEntry
): Promise<Uint8Array> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localHeaderOffset = entry.localHeaderOffset;

  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`Nieprawidlowy naglowek XLSX dla ${entry.name}.`);
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressedBytes = bytes.slice(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressedBytes;
  }

  if (entry.compressionMethod === 8) {
    return inflateRawBytes(compressedBytes);
  }

  throw new Error(`Nieobslugiwany sposob kompresji XLSX: ${entry.compressionMethod}.`);
};

const readZipTextEntry = async (
  bytes: Uint8Array,
  entriesByName: Map<string, ZipEntry>,
  entryName: string
) => {
  const entry = entriesByName.get(entryName);

  if (!entry) {
    return null;
  }

  return textDecoder.decode(await readZipEntryBytes(bytes, entry));
};

const parseXml = (text: string) => new DOMParser().parseFromString(text, "application/xml");

const getNodeText = (node: Element) =>
  Array.from(node.getElementsByTagName("t"))
    .map((item) => item.textContent ?? "")
    .join("");

const readSharedStrings = (xmlText: string | null) => {
  if (!xmlText) {
    return [];
  }

  const xml = parseXml(xmlText);
  return Array.from(xml.getElementsByTagName("si")).map(getNodeText);
};

const normalizeWorkbookRelationshipTarget = (target: string) => {
  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");

  if (normalizedTarget.startsWith("/")) {
    return normalizedTarget.slice(1);
  }

  if (normalizedTarget.startsWith("xl/")) {
    return normalizedTarget;
  }

  return `xl/${normalizedTarget}`;
};

const getWorkbookWorksheetEntries = async (
  bytes: Uint8Array,
  entriesByName: Map<string, ZipEntry>,
  worksheetEntries: ZipEntry[]
) => {
  const fallbackEntries = worksheetEntries.map((entry, index) => ({
    entry,
    order: index,
    sheetName: entry.name,
  }));
  const workbookText = await readZipTextEntry(bytes, entriesByName, "xl/workbook.xml");
  const workbookRelsText = await readZipTextEntry(
    bytes,
    entriesByName,
    "xl/_rels/workbook.xml.rels"
  );

  if (!workbookText || !workbookRelsText) {
    return fallbackEntries;
  }

  const workbookXml = parseXml(workbookText);
  const relsXml = parseXml(workbookRelsText);
  const relationships = Array.from(relsXml.getElementsByTagName("Relationship"));
  const seenEntryNames = new Set<string>();
  const workbookEntries = Array.from(workbookXml.getElementsByTagName("sheet"))
    .map((sheet, order) => {
      const relationshipId = sheet.getAttribute("r:id") ?? sheet.getAttribute("id") ?? "";

      if (!relationshipId) {
        return null;
      }

      const relationship = relationships.find(
        (item) => item.getAttribute("Id") === relationshipId
      );
      const target = relationship?.getAttribute("Target") ?? "";
      const targetEntryName = target ? normalizeWorkbookRelationshipTarget(target) : "";
      const entry = entriesByName.get(targetEntryName);

      if (!entry) {
        return null;
      }

      seenEntryNames.add(entry.name);

      return {
        entry,
        order,
        sheetName: sheet.getAttribute("name") ?? entry.name,
      } satisfies WorkbookWorksheetEntry;
    })
    .filter((item): item is WorkbookWorksheetEntry => Boolean(item));

  worksheetEntries.forEach((entry, index) => {
    if (!seenEntryNames.has(entry.name)) {
      workbookEntries.push({
        entry,
        order: workbookEntries.length + index,
        sheetName: entry.name,
      });
    }
  });

  return workbookEntries.length > 0 ? workbookEntries : fallbackEntries;
};

const getColumnIndex = (cellRef: string) => {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";

  return Array.from(letters).reduce(
    (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
    0
  ) - 1;
};

const getCellText = (cell: Element, sharedStrings: string[]) => {
  const type = cell.getAttribute("t");

  if (type === "s") {
    const sharedStringIndex = Number(cell.getElementsByTagName("v")[0]?.textContent ?? "");
    return sharedStrings[sharedStringIndex] ?? "";
  }

  if (type === "inlineStr") {
    const inlineString = cell.getElementsByTagName("is")[0];
    return inlineString ? getNodeText(inlineString) : "";
  }

  return (
    cell.getElementsByTagName("v")[0]?.textContent ??
    cell.getElementsByTagName("t")[0]?.textContent ??
    ""
  ).trim();
};

const parseWorksheetRows = async (xmlText: string, sharedStrings: string[]) => {
  const xml = parseXml(xmlText);
  const rowNodes = Array.from(xml.getElementsByTagName("row"));
  const rows: string[][] = [];

  for (let rowIndex = 0; rowIndex < rowNodes.length; rowIndex += 1) {
    if (rowIndex > 0 && rowIndex % 500 === 0) {
      await yieldToMainThread();
    }

    const row = rowNodes[rowIndex];
    const cells: string[] = [];

    Array.from(row.getElementsByTagName("c")).forEach((cell) => {
      const ref = cell.getAttribute("r") ?? "";
      const index = getColumnIndex(ref);

      if (index >= 0) {
        cells[index] = getCellText(cell, sharedStrings);
      } else {
        cells.push(getCellText(cell, sharedStrings));
      }
    });

    rows.push(cells.map((cell) => cell ?? ""));
  }

  return rows;
};

const getHeaderIndexes = (row: string[], requiredHeaders: string[]) => {
  const normalizedRow = row.map(normalizeHeader);
  const indexes = new Map<string, number>();

  for (const header of requiredHeaders) {
    const normalizedHeader = normalizeHeader(header);
    const index = normalizedRow.indexOf(normalizedHeader);

    if (index < 0) {
      return null;
    }

    indexes.set(normalizedHeader, index);
  }

  return indexes;
};

const findExactHeaderRow = (rows: string[][], requiredHeaders: string[]) => {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const indexes = getHeaderIndexes(rows[rowIndex], requiredHeaders);

    if (indexes) {
      return {
        indexes,
        rowIndex,
      };
    }
  }

  return null;
};

const getIndexedCell = (
  row: string[],
  indexes: Map<string, number>,
  header: string
) => {
  const index = indexes.get(normalizeHeader(header)) ?? -1;
  return index >= 0 ? (row[index] ?? "").trim() : "";
};

const parseXtbTradeComment = (comment: string) => {
  const match = comment.match(
    /^(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+(.+?)\s*@\s*([-+]?\d[\d.,]*)/i
  );

  if (!match) {
    return null;
  }

  const quantity = parseNumber(match[1].split("/")[0] ?? "");
  const price = parseNumber(match[2]);

  if (!quantity || quantity <= 0 || !price || price <= 0) {
    return null;
  }

  return {
    price,
    quantity,
  };
};

const parseXtbCashOperationRows = (
  rows: string[][],
  sheetName: string
): BrokerImportParseResult | null => {
  const header = findExactHeaderRow(rows, [
    "ID",
    "Type",
    "Time",
    "Comment",
    "Symbol",
    "Amount",
  ]);

  if (!header) {
    return null;
  }

  const operations: ImportedBrokerOperation[] = [];
  const skippedRows: BrokerImportParseResult["skippedRows"] = [];
  let cashRows = 0;
  let tradeRows = 0;

  rows.slice(header.rowIndex + 1).forEach((row, index) => {
    const rowNumber = header.rowIndex + index + 2;
    const id = getIndexedCell(row, header.indexes, "ID");
    const rawType = getIndexedCell(row, header.indexes, "Type");
    const normalizedType = normalizeHeader(rawType);

    if (!id || !rawType) {
      return;
    }

    cashRows += 1;

    if (normalizedType !== "stock purchase" && normalizedType !== "stock sale") {
      return;
    }

    tradeRows += 1;

    const rawTime = getIndexedCell(row, header.indexes, "Time");
    const rawSymbol = getIndexedCell(row, header.indexes, "Symbol");
    const comment = getIndexedCell(row, header.indexes, "Comment");
    const amount = parseNumber(getIndexedCell(row, header.indexes, "Amount"));
    const trade = parseXtbTradeComment(comment);
    const date = parseDate(rawTime);

    if (!date || !rawSymbol || !trade) {
      skippedRows.push({
        rowNumber,
        reason: "Nie udalo sie odczytac daty, symbolu, ilosci albo ceny z wiersza XTB.",
      });
      return;
    }

    const side: BrokerOperationSide = normalizedType === "stock purchase" ? "buy" : "sell";
    const kind = inferKind("", rawSymbol, rawSymbol);
    const currency = inferCurrencyFromSymbol(rawSymbol, "USD");
    const symbol = normalizeImportedSymbol(rawSymbol, kind, currency);
    const provider = getProvider(kind, symbol, currency);
    const serialTime = parseNumber(rawTime);
    const sortRowNumber =
      typeof serialTime === "number" && Number.isFinite(serialTime)
        ? Math.round(serialTime * 1_000_000)
        : rowNumber;

    operations.push({
      rowNumber: sortRowNumber,
      side,
      date,
      symbol,
      name: symbol,
      kind,
      quantity: round(trade.quantity, 6),
      price: round(trade.price, 6),
      currency,
      feePln: 0,
      transactionValue:
        typeof amount === "number" && Number.isFinite(amount)
          ? round(Math.abs(amount), 6)
          : undefined,
      provider,
      providerId: provider === "yahoo" || provider === "eodhd" ? symbol : undefined,
      warnings: [],
    });
  });

  if (tradeRows === 0) {
    return null;
  }

  const ignoredRows = Math.max(0, cashRows - tradeRows);

  return {
    operations,
    skippedRows,
    warnings: [
      `XTB XLSX: odczytano arkusz "${sheetName}" jako historie operacji gotowkowych.`,
      `XTB XLSX: rozpoznano ${tradeRows} rekordow Stock purchase/Stock sale.`,
      ignoredRows > 0
        ? `XTB XLSX: pominieto ${ignoredRows} rekordow gotowkowych, podatkowych, odsetkowych albo dywidendowych, bo ten importer dodaje tylko transakcje BUY/SELL.`
        : "",
    ].filter(Boolean),
  };
};

export const parseBrokerOperationsXlsx = async (
  bytes: Uint8Array,
  _preset: BrokerImportPreset = "xtb"
): Promise<BrokerImportParseResult> => {
  void _preset;

  const entries = readZipCentralDirectory(bytes);
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry] as const));
  const sharedStrings = readSharedStrings(
    await readZipTextEntry(bytes, entriesByName, "xl/sharedStrings.xml")
  );
  const worksheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const warnings = [
    "XLSX zostal odczytany z arkuszy Excela i zmapowany tym samym silnikiem co CSV.",
  ];

  if (worksheetEntries.length === 0) {
    return {
      operations: [],
      skippedRows: [{ rowNumber: 1, reason: "Nie znaleziono arkuszy w pliku XLSX." }],
      warnings,
    };
  }

  const workbookWorksheetEntries = await getWorkbookWorksheetEntries(
    bytes,
    entriesByName,
    worksheetEntries
  );
  const xtbWorksheetEntries = [...workbookWorksheetEntries].sort((left, right) => {
    const leftIsCash = normalizeHeader(left.sheetName).includes("cash operation");
    const rightIsCash = normalizeHeader(right.sheetName).includes("cash operation");

    if (leftIsCash !== rightIsCash) {
      return leftIsCash ? -1 : 1;
    }

    return left.order - right.order;
  });

  for (const worksheet of xtbWorksheetEntries) {
    const worksheetText = await readZipTextEntry(bytes, entriesByName, worksheet.entry.name);

    if (!worksheetText) {
      continue;
    }

    const rows = await parseWorksheetRows(worksheetText, sharedStrings);
    const xtbResult = parseXtbCashOperationRows(rows, worksheet.sheetName);

    if (xtbResult) {
      return xtbResult;
    }

    await yieldToMainThread();
  }

  const firstWorksheetEntry = workbookWorksheetEntries[0]?.entry ?? worksheetEntries[0];

  if (!firstWorksheetEntry) {
    return {
      operations: [],
      skippedRows: [{ rowNumber: 1, reason: "Nie znaleziono tabeli operacji w XLSX." }],
      warnings,
    };
  }

  await yieldToMainThread();

  const worksheetText = await readZipTextEntry(bytes, entriesByName, firstWorksheetEntry.name);

  if (!worksheetText) {
    return {
      operations: [],
      skippedRows: [{ rowNumber: 1, reason: "Nie udalo sie odczytac pierwszego arkusza XLSX." }],
      warnings,
    };
  }

  const rows = await parseWorksheetRows(worksheetText, sharedStrings);

  await yieldToMainThread();

  return parseBrokerOperationRows(rows, warnings);
};

export const parseBrokerOperationsPdf = async (
  bytes: Uint8Array,
  _preset: BrokerImportPreset = "xtb"
): Promise<BrokerImportParseResult> => {
  void _preset;

  const extractedText = await extractTextFromPdfBytes(bytes);
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
          reason:
            extractedText.trim().length === 0
              ? "PDF wyglada jak skan albo obraz bez warstwy tekstowej."
              : "Nie znaleziono dat transakcji w odczytanej warstwie tekstowej PDF.",
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
