import { inflateSync as inflateDeflateRawSync, unzlibSync } from "fflate";
import { getDefaultProviderForKind, inferCurrencyFromSymbol, isGpwSymbol, normalizeGpwSymbol, normalizeSymbol } from "@/lib/ticker";
import { resolveTickerAlias } from "@/lib/ticker-aliases";
import { normalizeText, round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type { AssetKind, CurrencyCode, OperationType, QuoteProvider } from "@/types/portfolio";

export type BrokerImportPreset = "auto" | "xtb" | "degiro" | "ibkr" | "mbank" | "etoro" | "trading212" | "generic";

export type BrokerOperationSide = "buy" | "sell";

export type ImportedBrokerOperation = {
  rowNumber: number;
  operationType?: OperationType;
  side?: BrokerOperationSide;
  date: string;
  symbol: string;
  name: string;
  kind: AssetKind;
  quantity: number;
  price: number;
  currency: CurrencyCode;
  feePln: number;
  fee?: number;
  tax?: number;
  amount?: number;
  exchangeRate?: number;
  grossAmount?: number;
  netAmount?: number;
  dividendPerShare?: number;
  accountNumber?: string;
  accountCurrency?: CurrencyCode;
  sourceAccountNumber?: string;
  targetAccountNumber?: string;
  sourceCurrency?: CurrencyCode;
  targetCurrency?: CurrencyCode;
  targetAmount?: number;
  broker?: string;
  brokerOperationId?: string;
  importKey?: string;
  rawType?: string;
  rawTime?: string;
  rawSymbol?: string;
  isin?: string;
  realizedProfitLoss?: number;
  purchaseValue?: number;
  saleValue?: number;
  transactionValue?: number;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
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

const normalizeHeader = (value: string | null | undefined) =>
  normalizeText(value ?? "").replace(/\s+/g, " ");

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
    const alias = resolveTickerAlias(rawSymbol, kind);
    const symbol = alias?.symbol ?? normalizeImportedSymbol(rawSymbol, kind, currency);

    if (!side || !rawDate || !symbol || !quantity || quantity <= 0 || !price || price <= 0) {
      skippedRows.push({
        rowNumber,
        reason: "Brakuje typu, daty, symbolu, ilosci albo ceny.",
      });
      return;
    }

    const provider = alias?.provider ?? getProvider(kind, symbol, alias?.marketCurrency ?? currency);

    operations.push({
      rowNumber,
      operationType: side === "buy" ? "BUY" : "SELL",
      side,
      date: rawDate,
      symbol,
      rawSymbol,
      name: alias?.name ?? (rawName || symbol),
      kind: alias?.kind ?? kind,
      quantity: round(Math.abs(quantity), 6),
      price: round(Math.abs(price), 6),
      currency: alias?.marketCurrency ?? currency,
      feePln: round(Math.abs(fee), 6),
      fee: round(Math.abs(fee), 6),
      amount:
        typeof transactionValue === "number" && Number.isFinite(transactionValue)
          ? round(Math.abs(transactionValue), 6)
          : round(Math.abs(quantity * price), 6),
      transactionValue:
        typeof transactionValue === "number" && Number.isFinite(transactionValue)
          ? round(Math.abs(transactionValue), 6)
          : undefined,
      provider,
      providerId:
        alias?.providerId ??
        (provider === "yahoo" || provider === "eodhd" ? symbol : undefined),
      priceScale: alias?.priceScale,
      isin: alias?.isin,
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

const PDF_STRING_PATTERN = /\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]{4,})>/g;
const PDF_TEXT_HINT_PATTERN =
  /\b(CASH|OPERATION|HISTORY|POSITION|Account|Currency|Stock|purchase|sale|deposit|transfer|withdrawal|DIVIDENT|Dividend|Withholding|Interest|Total|PLN|USD|EUR|GBP|XTB)\b/i;
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

type PdfCMap = {
  chars: Map<number, string>;
  ranges: Array<{
    start: number;
    end: number;
    unicodeStart: number;
  }>;
};

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

const parsePdfHexNumber = (value: string) => parseInt(value.replace(/\s/g, ""), 16);

const decodePdfUnicodeHex = (value: string) => {
  const cleanHex = value.replace(/\s/g, "");

  if (!cleanHex) {
    return "";
  }

  if (cleanHex.length <= 4) {
    return String.fromCharCode(parseInt(cleanHex, 16));
  }

  const evenHex = cleanHex.length % 2 === 0 ? cleanHex : `${cleanHex}0`;
  const bytes: number[] = [];

  for (let index = 0; index < evenHex.length; index += 2) {
    bytes.push(parseInt(evenHex.slice(index, index + 2), 16));
  }

  return decodeUtf16Be(bytes);
};

const extractPdfCMaps = (rawText: string): PdfCMap[] => {
  const cMapBlocks = rawText.match(/begincmap[\s\S]*?endcmap/g) ?? [];

  return cMapBlocks
    .map((block) => {
      const chars = new Map<number, string>();
      const ranges: PdfCMap["ranges"] = [];

      Array.from(block.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)).forEach((match) => {
        Array.from(
          (match[1] ?? "").matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>/g)
        ).forEach((charMatch) => {
          chars.set(parsePdfHexNumber(charMatch[1]), decodePdfUnicodeHex(charMatch[2]));
        });
      });

      Array.from(block.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)).forEach((match) => {
        Array.from(
          (match[1] ?? "").matchAll(
            /<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>/g
          )
        ).forEach((rangeMatch) => {
          ranges.push({
            start: parsePdfHexNumber(rangeMatch[1]),
            end: parsePdfHexNumber(rangeMatch[2]),
            unicodeStart: parsePdfHexNumber(rangeMatch[3]),
          });
        });
      });

      return chars.size > 0 || ranges.length > 0 ? { chars, ranges } : null;
    })
    .filter((cMap): cMap is PdfCMap => Boolean(cMap));
};

const decodePdfHexStringWithCMap = (value: string, cMap: PdfCMap) => {
  const cleanHex = value.replace(/\s/g, "");

  if (!cleanHex || cleanHex.length < 4) {
    return "";
  }

  let decoded = "";

  for (let index = 0; index + 3 < cleanHex.length; index += 4) {
    const code = parseInt(cleanHex.slice(index, index + 4), 16);
    const directChar = cMap.chars.get(code);

    if (directChar) {
      decoded += directChar;
      continue;
    }

    const range = cMap.ranges.find((candidate) => code >= candidate.start && code <= candidate.end);
    decoded += range
      ? String.fromCharCode(range.unicodeStart + code - range.start)
      : String.fromCharCode(code);
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

const getTextQualityScore = (value: string) => {
  const printableRatio = getPrintableRatio(value);
  const usefulCharacters = value.replace(/[^a-zA-Z0-9 .,:;/'()@_\-+]/g, "").length;
  const hasTextHint = PDF_TEXT_HINT_PATTERN.test(value) ? 1 : 0;

  return printableRatio + usefulCharacters / Math.max(1, value.length) + hasTextHint;
};

const decodePdfHexStringBestEffort = (value: string, cMaps: PdfCMap[]) => {
  const cMapCandidates = cMaps
    .map((cMap) => decodePdfHexStringWithCMap(value, cMap))
    .filter(Boolean)
    .sort((left, right) => getTextQualityScore(right) - getTextQualityScore(left));
  const bestCMapCandidate = cMapCandidates[0];

  if (bestCMapCandidate && getPrintableRatio(bestCMapCandidate) > 0.65) {
    return bestCMapCandidate;
  }

  return decodePdfHexString(value);
};

const getPdfTextPartsFromRawText = (rawText: string, cMaps: PdfCMap[] = []) => {
  const textParts: string[] = [];
  const stringMatches = rawText.match(PDF_STRING_PATTERN) ?? [];

  stringMatches.forEach((match) => {
    const decoded = match.startsWith("(")
      ? decodePdfLiteral(match).trim()
      : decodePdfHexStringBestEffort(match.slice(1, -1), cMaps).trim();

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
  const flateStreams = extractPdfFlateStreams(rawText);
  const decodedStreams: string[] = [];

  for (const streamBytes of flateStreams) {
    const inflated = await inflatePdfBytes(streamBytes);

    if (!inflated) {
      continue;
    }

    decodedStreams.push(new TextDecoder("latin1").decode(inflated));
  }

  const cMaps = [rawText, ...decodedStreams].flatMap(extractPdfCMaps);
  const textParts = [
    ...getPdfTextPartsFromRawText(rawText, cMaps),
    ...decodedStreams.flatMap((streamText) => getPdfTextPartsFromRawText(streamText, cMaps)),
  ];

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
  const alias = resolveTickerAlias(rawSymbol, kind);
  const symbol = alias?.symbol ?? normalizeImportedSymbol(rawSymbol, kind, currency);
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

  const provider = alias?.provider ?? getProvider(kind, symbol, alias?.marketCurrency ?? currency);
  const name = extractPdfName(chunk, dateText, rawSymbol);

  return {
    rowNumber,
    operationType: side === "buy" ? "BUY" : "SELL",
    side,
    date: rawDate,
    symbol,
    rawSymbol,
    name: alias?.name ?? name,
    kind: alias?.kind ?? kind,
    quantity: round(Math.abs(quantity), 6),
    price: round(Math.abs(price), 6),
    currency: alias?.marketCurrency ?? currency,
    feePln: round(Math.abs(fee), 6),
    fee: round(Math.abs(fee), 6),
    amount:
      typeof transactionValue === "number" && Number.isFinite(transactionValue)
        ? round(Math.abs(transactionValue), 6)
        : round(Math.abs(quantity * price), 6),
    transactionValue:
      typeof transactionValue === "number" && Number.isFinite(transactionValue)
        ? round(Math.abs(transactionValue), 6)
        : undefined,
    provider,
    providerId:
      alias?.providerId ??
      (provider === "yahoo" || provider === "eodhd" ? symbol : undefined),
    priceScale: alias?.priceScale,
    isin: alias?.isin,
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
  try {
    return new Uint8Array(inflateDeflateRawSync(bytes));
  } catch {
    // Browser fallback below covers environments where fflate cannot decode a stream.
  }

  if (typeof DecompressionStream === "undefined") {
    throw new Error("Ta przegladarka nie wspiera rozpakowywania XLSX.");
  }

  const stream = new Blob([toArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));

  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const inflatePdfBytes = async (bytes: Uint8Array) => {
  for (const inflate of [unzlibSync, inflateDeflateRawSync]) {
    try {
      return new Uint8Array(inflate(bytes));
    } catch {
      // Try the next PDF deflate framing variant.
    }
  }

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

    rows.push(Array.from({ length: cells.length }, (_, index) => cells[index] ?? ""));
  }

  return rows;
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

type XtbHeader = {
  indexes: Map<string, number>;
  rowIndex: number;
};

type XtbClosedPosition = {
  ticker: string;
  closeSerial: number | null;
  closeDate: string;
  volume: number;
  closePrice: number;
  realizedProfitLoss: number;
  purchaseValue: number;
  saleValue: number;
};

type XtbCashRow = {
  rowNumber: number;
  id: string;
  rawType: string;
  normalizedType: string;
  rawTime: string;
  serialTime: number | null;
  date: string;
  rawSymbol: string;
  instrumentName: string;
  comment: string;
  amount: number | null;
};

const XTB_CASH_HEADER_ALIASES: Record<string, string[]> = {
  id: ["id"],
  type: ["type", "typ"],
  time: ["time", "czas", "date", "data"],
  comment: ["comment", "komentarz", "opis"],
  symbol: ["symbol", "ticker", "instrument"],
  amount: ["amount", "kwota", "wartosc"],
  instrument: ["instrument", "nazwa instrumentu", "name"],
};

const XTB_CLOSED_HEADER_ALIASES: Record<string, string[]> = {
  instrument: ["instrument"],
  category: ["category"],
  ticker: ["ticker", "symbol"],
  type: ["type"],
  volume: ["volume"],
  openPrice: ["open price"],
  openTime: ["open time (utc)", "open time"],
  closePrice: ["close price"],
  closeTime: ["close time (utc)", "close time"],
  profitLoss: ["profit/loss", "profit loss"],
  purchaseValue: ["purchase value"],
  saleValue: ["sale value"],
};

const findFlexibleHeaderRow = (
  rows: string[][],
  aliases: Record<string, string[]>,
  requiredKeys: string[]
): XtbHeader | null => {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalizedRow = rows[rowIndex].map(normalizeHeader);
    const indexes = new Map<string, number>();

    Object.entries(aliases).forEach(([key, keyAliases]) => {
      const index = keyAliases
        .map((alias) => normalizedRow.indexOf(normalizeHeader(alias)))
        .find((candidateIndex) => candidateIndex >= 0);

      if (typeof index === "number" && index >= 0) {
        indexes.set(key, index);
      }
    });

    if (requiredKeys.every((key) => indexes.has(key))) {
      return {
        indexes,
        rowIndex,
      };
    }
  }

  return null;
};

const getMappedCell = (row: string[], header: XtbHeader, key: string) => {
  const index = header.indexes.get(key) ?? -1;
  return index >= 0 ? (row[index] ?? "").trim() : "";
};

const detectXtbAccountNumber = (rows: string[][]) => {
  for (const row of rows.slice(0, 12)) {
    const label = normalizeHeader(row[0] ?? "");

    if (label === "account number" || label === "account") {
      const value = (row[1] ?? "").trim();
      if (value) return value;
    }
  }

  return "";
};

const parseXtbTransferComment = (comment: string) => {
  const match = comment.match(
    /currency\s+conversion,\s*([A-Z]{3})\s+to\s+([A-Z]{3}).*?from\s+TA:\s*(\d+)\s+to:\s*(\d+).*?exchange\s+rate\s*:\s*([-+]?\d[\d.,]*)/i
  );

  if (!match) {
    return null;
  }

  const exchangeRate = parseNumber(match[5]);

  return {
    sourceCurrency: toCurrencyCode(match[1]),
    targetCurrency: toCurrencyCode(match[2]),
    sourceAccountNumber: match[3],
    targetAccountNumber: match[4],
    exchangeRate: exchangeRate && exchangeRate > 0 ? exchangeRate : null,
  };
};

const detectXtbAccountCurrency = (
  rows: string[][],
  accountNumber: string,
  fallback: CurrencyCode = "PLN"
) => {
  const currencyVotes = new Map<CurrencyCode, number>();
  const vote = (currency: CurrencyCode, weight = 1) => {
    currencyVotes.set(currency, (currencyVotes.get(currency) ?? 0) + weight);
  };

  rows.slice(0, 20).forEach((row) => {
    const currencyIndex = row.findIndex((cell) => normalizeHeader(cell) === "currency");
    const currency = currencyIndex >= 0 ? row[currencyIndex + 1] : "";

    if (currency) {
      vote(toCurrencyCode(currency, fallback), 10);
    }
  });

  rows.forEach((row) => {
    const comment = row.join(" ");
    const transfer = parseXtbTransferComment(comment);

    if (transfer && accountNumber) {
      if (transfer.sourceAccountNumber === accountNumber) {
        vote(transfer.sourceCurrency, 8);
      }

      if (transfer.targetAccountNumber === accountNumber) {
        vote(transfer.targetCurrency, 8);
      }
    }

    const currencyMatch = comment.match(/\b(PLN|USD|EUR|GBP|CHF|DKK|CZK|CAD|JPY|NOK|SEK)\b/i);
    if (currencyMatch) {
      vote(toCurrencyCode(currencyMatch[1], fallback));
    }
  });

  return (
    Array.from(currencyVotes.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ??
    fallback
  );
};

const getXtbOperationImportKey = (
  operation: Pick<ImportedBrokerOperation, "brokerOperationId" | "rawTime" | "rawType" | "symbol" | "amount" | "accountNumber">
) =>
  [
    "xtb",
    operation.brokerOperationId,
    operation.rawTime,
    operation.rawType,
    operation.accountNumber,
    operation.symbol,
    operation.amount,
  ]
    .filter((item) => item !== undefined && item !== null && String(item).trim())
    .join(":");

const getXtbTransferImportKey = (
  row: XtbCashRow,
  transfer: NonNullable<ReturnType<typeof parseXtbTransferComment>>
) => {
  const timestampSeconds =
    row.serialTime && Number.isFinite(row.serialTime)
      ? Math.round(row.serialTime * 86_400)
      : row.date;

  return [
    "xtb-transfer",
    timestampSeconds,
    transfer.sourceAccountNumber,
    transfer.targetAccountNumber,
    transfer.sourceCurrency,
    transfer.targetCurrency,
    transfer.exchangeRate ? round(transfer.exchangeRate, 8) : "",
  ].join(":");
};

const getXtbDividendPerShare = (comment: string) => {
  const match = comment.match(/\b[A-Z]{3}\s+([-+]?\d[\d.,]*)\s*\/\s*SHR\b/i);
  return match?.[1] ? parseNumber(match[1]) : null;
};

const getXtbCommentCurrency = (comment: string, fallback: CurrencyCode) =>
  toCurrencyCode(comment.match(/\b(PLN|USD|EUR|GBP|CHF|DKK|CZK|CAD|JPY|NOK|SEK)\b/i)?.[1], fallback);

const isXtbBuyType = (normalizedType: string) => normalizedType === "stock purchase";
const isXtbSellType = (normalizedType: string) =>
  normalizedType === "stock sell" || normalizedType === "stock sale";
const isXtbDividendType = (normalizedType: string) =>
  normalizedType === "dividend" ||
  normalizedType === "cash dividend" ||
  normalizedType === "dywidenda" ||
  normalizedType === "divident";
const isXtbWithholdingTaxType = (normalizedType: string) =>
  normalizedType === "withholding tax" ||
  normalizedType === "withholding taxes" ||
  normalizedType === "podatek u zrodla";
const isXtbInterestType = (normalizedType: string) =>
  normalizedType === "free funds interest" || normalizedType === "interest";
const isXtbInterestTaxType = (normalizedType: string) =>
  normalizedType === "free funds interest tax" || normalizedType === "interest tax";
const isXtbFeeType = (normalizedType: string) =>
  normalizedType === "fee" ||
  normalizedType === "fees" ||
  normalizedType === "commission" ||
  normalizedType === "swap";

const parseXtbCashRows = (rows: string[][], header: XtbHeader): XtbCashRow[] =>
  rows
    .slice(header.rowIndex + 1)
    .map((row, index) => {
      const rawTime = getMappedCell(row, header, "time");
      const serialTime = parseNumber(rawTime);
      const rawType = getMappedCell(row, header, "type");

      return {
        rowNumber:
          typeof serialTime === "number" && Number.isFinite(serialTime)
            ? Math.round(serialTime * 1_000_000)
            : header.rowIndex + index + 2,
        id: getMappedCell(row, header, "id"),
        rawType,
        normalizedType: normalizeHeader(rawType),
        rawTime,
        serialTime:
          typeof serialTime === "number" && Number.isFinite(serialTime)
            ? serialTime
            : null,
        date: parseDate(rawTime),
        rawSymbol: getMappedCell(row, header, "symbol"),
        instrumentName: getMappedCell(row, header, "instrument"),
        comment: getMappedCell(row, header, "comment"),
        amount: parseNumber(getMappedCell(row, header, "amount")),
      } satisfies XtbCashRow;
    })
    .filter((row) => row.id && row.rawType && row.normalizedType !== "total");

const buildBaseXtbOperation = ({
  row,
  accountCurrency,
  operationType,
  symbol = "",
  name = "",
  kind = "stock",
  quantity = 0,
  price = 0,
  currency = accountCurrency,
  amount,
  fee = 0,
  tax = 0,
  exchangeRate,
  side,
}: {
  row: XtbCashRow;
  accountCurrency: CurrencyCode;
  operationType: OperationType;
  symbol?: string;
  name?: string;
  kind?: AssetKind;
  quantity?: number;
  price?: number;
  currency?: CurrencyCode;
  amount: number;
  fee?: number;
  tax?: number;
  exchangeRate?: number;
  side?: BrokerOperationSide;
}): ImportedBrokerOperation => {
  const alias = symbol ? resolveTickerAlias(symbol, kind) : null;
  const resolvedSymbol = alias?.symbol ?? (symbol ? normalizeImportedSymbol(symbol, kind, currency) : "");
  const resolvedKind = alias?.kind ?? kind;
  const resolvedCurrency = alias?.marketCurrency ?? currency;
  const provider = alias?.provider ?? getProvider(resolvedKind, resolvedSymbol, resolvedCurrency);
  const operation: ImportedBrokerOperation = {
    rowNumber: row.rowNumber,
    operationType,
    side,
    date: row.date,
    symbol: resolvedSymbol,
    name: alias?.name ?? (name.trim() || resolvedSymbol || row.rawType),
    kind: resolvedKind,
    quantity: round(Math.abs(quantity), 6),
    price: round(Math.abs(price), 6),
    currency: resolvedCurrency,
    feePln: 0,
    fee: round(Math.abs(fee), 6),
    tax: round(Math.abs(tax), 6),
    amount: round(Math.abs(amount), 6),
    exchangeRate,
    transactionValue: amount ? round(Math.abs(amount), 6) : undefined,
    accountCurrency,
    broker: "XTB",
    brokerOperationId: row.id,
    rawType: row.rawType,
    rawTime: row.rawTime,
    rawSymbol: symbol,
    provider,
    providerId:
      alias?.providerId ??
      (provider === "yahoo" || provider === "eodhd" ? resolvedSymbol : undefined),
    priceScale: alias?.priceScale,
    isin: alias?.isin,
    warnings: [],
  };

  return {
    ...operation,
    importKey: getXtbOperationImportKey(operation),
  };
};

const findMatchingXtbDividendTax = (
  dividend: XtbCashRow,
  taxRows: XtbCashRow[],
  usedTaxRowIds: Set<string>
) => {
  const dividendTime = dividend.serialTime ?? 0;

  return taxRows
    .filter((taxRow) => !usedTaxRowIds.has(taxRow.id))
    .filter((taxRow) => normalizeSymbol(taxRow.rawSymbol) === normalizeSymbol(dividend.rawSymbol))
    .filter((taxRow) => taxRow.date === dividend.date)
    .map((taxRow) => ({
      taxRow,
      distance:
        dividend.serialTime && taxRow.serialTime
          ? Math.abs(dividendTime - taxRow.serialTime)
          : Math.abs(taxRow.rowNumber - dividend.rowNumber),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        Math.abs(left.taxRow.rowNumber - dividend.rowNumber) -
          Math.abs(right.taxRow.rowNumber - dividend.rowNumber)
    )[0]?.taxRow;
};

const parseXtbClosedPositionRows = (rows: string[][]): XtbClosedPosition[] => {
  const header = findFlexibleHeaderRow(rows, XTB_CLOSED_HEADER_ALIASES, [
    "ticker",
    "volume",
    "closePrice",
    "closeTime",
    "profitLoss",
    "purchaseValue",
    "saleValue",
  ]);

  if (!header) {
    return [];
  }

  return rows
    .slice(header.rowIndex + 1)
    .map((row) => {
      const ticker = getMappedCell(row, header, "ticker");
      const closeSerial = parseNumber(getMappedCell(row, header, "closeTime"));
      const closeDate = parseDate(getMappedCell(row, header, "closeTime"));
      const volume = parseNumber(getMappedCell(row, header, "volume"));
      const closePrice = parseNumber(getMappedCell(row, header, "closePrice"));
      const realizedProfitLoss = parseNumber(getMappedCell(row, header, "profitLoss"));
      const purchaseValue = parseNumber(getMappedCell(row, header, "purchaseValue"));
      const saleValue = parseNumber(getMappedCell(row, header, "saleValue"));

      if (
        !ticker ||
        !closeDate ||
        !volume ||
        volume <= 0 ||
        !closePrice ||
        closePrice <= 0 ||
        realizedProfitLoss === null ||
        purchaseValue === null ||
        saleValue === null
      ) {
        return null;
      }

      return {
        ticker,
        closeSerial:
          typeof closeSerial === "number" && Number.isFinite(closeSerial)
            ? closeSerial
            : null,
        closeDate,
        volume: round(volume, 6),
        closePrice: round(closePrice, 6),
        realizedProfitLoss: round(realizedProfitLoss, 6),
        purchaseValue: round(Math.abs(purchaseValue), 6),
        saleValue: round(Math.abs(saleValue), 6),
      } satisfies XtbClosedPosition;
    })
    .filter((position): position is XtbClosedPosition => Boolean(position));
};

const enrichXtbSalesWithClosedPositions = (
  operations: ImportedBrokerOperation[],
  closedPositions: XtbClosedPosition[]
) => {
  const usedIndexes = new Set<number>();

  return operations.map((operation) => {
    if (operation.operationType !== "SELL") {
      return operation;
    }

    const operationTime =
      operation.rawTime && parseNumber(operation.rawTime)
        ? parseNumber(operation.rawTime)
        : null;
    const matchingPosition = closedPositions
      .map((position, index) => ({ position, index }))
      .filter(({ index }) => !usedIndexes.has(index))
      .filter(
        ({ position }) =>
          normalizeSymbol(position.ticker) === normalizeSymbol(operation.rawSymbol ?? operation.symbol) ||
          normalizeSymbol(position.ticker) === normalizeSymbol(operation.symbol)
      )
      .filter(({ position }) => position.closeDate === operation.date)
      .filter(({ position }) => Math.abs(position.volume - operation.quantity) < 0.0001)
      .filter(({ position }) => Math.abs(position.closePrice - operation.price) < 0.01)
      .sort((left, right) => {
        if (operationTime && left.position.closeSerial && right.position.closeSerial) {
          return (
            Math.abs(left.position.closeSerial - operationTime) -
            Math.abs(right.position.closeSerial - operationTime)
          );
        }

        return 0;
      })[0];

    if (!matchingPosition) {
      return operation;
    }

    usedIndexes.add(matchingPosition.index);

    return {
      ...operation,
      realizedProfitLoss: matchingPosition.position.realizedProfitLoss,
      purchaseValue: matchingPosition.position.purchaseValue,
      saleValue: matchingPosition.position.saleValue,
    };
  });
};

const parseXtbCashOperationRows = (
  rows: string[][],
  sheetName: string
): BrokerImportParseResult | null => {
  const header = findFlexibleHeaderRow(rows, XTB_CASH_HEADER_ALIASES, [
    "id",
    "type",
    "time",
    "comment",
    "symbol",
    "amount",
  ]);

  if (!header) {
    return null;
  }

  const accountNumber = detectXtbAccountNumber(rows);
  const accountCurrency = detectXtbAccountCurrency(rows, accountNumber);
  const cashRowsForProcessing = parseXtbCashRows(rows, header);
  const operations: ImportedBrokerOperation[] = [];
  const skippedRows: BrokerImportParseResult["skippedRows"] = [];
  const taxRows = cashRowsForProcessing.filter((row) =>
    isXtbWithholdingTaxType(row.normalizedType)
  );
  const usedDividendTaxRowIds = new Set<string>();
  const dividendTaxRowsByDividendId = new Map<string, XtbCashRow>();
  let tradeRows = 0;
  let dividendRows = 0;
  let cashRows = 0;

  cashRowsForProcessing
    .filter((row) => isXtbDividendType(row.normalizedType))
    .forEach((dividendRow) => {
      const matchingTaxRow = findMatchingXtbDividendTax(
        dividendRow,
        taxRows,
        usedDividendTaxRowIds
      );

      if (matchingTaxRow) {
        usedDividendTaxRowIds.add(matchingTaxRow.id);
        dividendTaxRowsByDividendId.set(dividendRow.id, matchingTaxRow);
      }
    });

  cashRowsForProcessing.forEach((row) => {
    if (!row.date) {
      skippedRows.push({
        rowNumber: row.rowNumber,
        reason: "Nie udalo sie odczytac daty z wiersza XTB.",
      });
      return;
    }

    const signedAmount = row.amount ?? 0;
    const absoluteAmount = Math.abs(signedAmount);

    if (isXtbBuyType(row.normalizedType) || isXtbSellType(row.normalizedType)) {
      const trade = parseXtbTradeComment(row.comment);

      if (!row.rawSymbol || !trade) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          reason: "Nie udalo sie odczytac symbolu, ilosci albo ceny z transakcji XTB.",
        });
        return;
      }

      const side: BrokerOperationSide = isXtbBuyType(row.normalizedType) ? "buy" : "sell";
      const kind = inferKind(row.rawType, row.rawSymbol, row.instrumentName || row.rawSymbol);
      const marketCurrency = inferCurrencyFromSymbol(row.rawSymbol, accountCurrency);
      const grossMarketValue = trade.quantity * trade.price;
      const exchangeRate =
        grossMarketValue > 0 && accountCurrency !== marketCurrency && absoluteAmount > 0
          ? round(absoluteAmount / grossMarketValue, 8)
          : accountCurrency === marketCurrency
            ? 1
            : undefined;

      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: side === "buy" ? "BUY" : "SELL",
          symbol: row.rawSymbol,
          name: row.instrumentName || row.rawSymbol,
          kind,
          quantity: trade.quantity,
          price: trade.price,
          currency: marketCurrency,
          amount: absoluteAmount,
          exchangeRate,
          side,
        }),
        accountNumber,
      });
      tradeRows += 1;
      return;
    }

    if (isXtbDividendType(row.normalizedType)) {
      const kind = inferKind(row.rawType, row.rawSymbol, row.instrumentName || row.rawSymbol);
      const dividendCurrency = getXtbCommentCurrency(row.comment, accountCurrency);
      const dividendPerShare = getXtbDividendPerShare(row.comment);
      const matchingTaxRow = dividendTaxRowsByDividendId.get(row.id);
      const withholdingTax = Math.abs(matchingTaxRow?.amount ?? 0);
      const grossAmount = absoluteAmount;
      const netAmount = Math.max(0, round(grossAmount - withholdingTax, 6));
      const quantity =
        dividendPerShare && dividendPerShare > 0
          ? round(grossAmount / dividendPerShare, 6)
          : 0;

      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: "DIVIDEND",
          symbol: row.rawSymbol,
          name: row.instrumentName || row.rawSymbol,
          kind,
          quantity,
          price: dividendPerShare ?? 0,
          currency: dividendCurrency,
          amount: netAmount,
          tax: withholdingTax,
          exchangeRate: dividendCurrency === accountCurrency ? 1 : undefined,
        }),
        accountNumber,
        grossAmount,
        netAmount,
        dividendPerShare: dividendPerShare ?? undefined,
        tax: withholdingTax,
        transactionValue: grossAmount,
      });
      dividendRows += 1;
      return;
    }

    if (isXtbWithholdingTaxType(row.normalizedType)) {
      if (usedDividendTaxRowIds.has(row.id)) {
        return;
      }

      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: "TAX",
          symbol: row.rawSymbol,
          name: row.instrumentName || row.rawSymbol || "Podatek",
          kind: inferKind(row.rawType, row.rawSymbol, row.instrumentName || row.rawSymbol),
          currency: getXtbCommentCurrency(row.comment, accountCurrency),
          amount: absoluteAmount,
          tax: absoluteAmount,
        }),
        accountNumber,
      });
      cashRows += 1;
      return;
    }

    if (row.normalizedType === "deposit") {
      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: "DEPOSIT",
          amount: absoluteAmount,
        }),
        accountNumber,
      });
      cashRows += 1;
      return;
    }

    if (row.normalizedType === "withdrawal" || row.normalizedType === "withdraw") {
      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: "WITHDRAW",
          amount: absoluteAmount,
        }),
        accountNumber,
      });
      cashRows += 1;
      return;
    }

    if (row.normalizedType === "transfer") {
      const transfer = parseXtbTransferComment(row.comment);
      const operation = buildBaseXtbOperation({
        row,
        accountCurrency,
        operationType: transfer ? "CONVERSION" : "TRANSFER",
        amount: absoluteAmount,
        currency: transfer?.sourceCurrency ?? accountCurrency,
        exchangeRate: transfer?.exchangeRate ?? undefined,
      });

      if (transfer?.exchangeRate) {
        const isCurrentSource = transfer.sourceAccountNumber === accountNumber || signedAmount < 0;
        const targetAmount = isCurrentSource
          ? round(absoluteAmount * transfer.exchangeRate, 6)
          : absoluteAmount;
        const sourceAmount = isCurrentSource
          ? absoluteAmount
          : round(absoluteAmount / transfer.exchangeRate, 6);

        operations.push({
          ...operation,
          accountNumber: transfer.sourceAccountNumber,
          accountCurrency: transfer.sourceCurrency,
          currency: transfer.sourceCurrency,
          amount: sourceAmount,
          targetAccountNumber: transfer.targetAccountNumber,
          targetCurrency: transfer.targetCurrency,
          targetAmount,
          sourceAccountNumber: transfer.sourceAccountNumber,
          sourceCurrency: transfer.sourceCurrency,
          importKey: getXtbTransferImportKey(row, transfer),
        });
      } else {
        operations.push({
          ...operation,
          accountNumber,
        });
      }

      cashRows += 1;
      return;
    }

    if (isXtbInterestType(row.normalizedType)) {
      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: "INTEREST",
          amount: absoluteAmount,
        }),
        accountNumber,
      });
      cashRows += 1;
      return;
    }

    if (isXtbInterestTaxType(row.normalizedType)) {
      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: "TAX",
          amount: absoluteAmount,
          tax: absoluteAmount,
        }),
        accountNumber,
      });
      cashRows += 1;
      return;
    }

    if (isXtbFeeType(row.normalizedType)) {
      operations.push({
        ...buildBaseXtbOperation({
          row,
          accountCurrency,
          operationType: "FEE",
          amount: absoluteAmount,
          fee: absoluteAmount,
        }),
        accountNumber,
      });
      cashRows += 1;
      return;
    }

    if (row.normalizedType !== "close trade") {
      skippedRows.push({
        rowNumber: row.rowNumber,
        reason: `Nieobslugiwany typ operacji XTB: ${row.rawType}.`,
      });
    }
  });

  if (operations.length === 0) {
    return null;
  }

  const sourceKind = /pdf/i.test(sheetName)
    ? "XTB PDF"
    : /mhtml|html/i.test(sheetName)
      ? "XTB MHTML/HTML"
      : "XTB XLSX";

  return {
    operations,
    skippedRows,
    warnings: [
      `${sourceKind}: odczytano "${sheetName}" jako historie operacji gotowkowych.`,
      accountNumber ? `${sourceKind}: rachunek ${accountNumber}, waluta ${accountCurrency}.` : "",
      `${sourceKind}: rozpoznano ${tradeRows} transakcji, ${dividendRows} dywidend oraz ${cashRows} operacji gotowkowych/podatkowych.`,
    ].filter(Boolean),
  };
};

const XTB_TEXT_OPERATION_TYPES = [
  "Free-funds Interest Tax",
  "Free funds interest tax",
  "Free-funds Interest",
  "Free funds interest",
  "Withholding Tax",
  "Withholding tax",
  "Cash Dividend",
  "Stock purchase",
  "Stock sale",
  "Stock sell",
  "close trade",
  "Close trade",
  "withdrawal",
  "Withdrawal",
  "deposit",
  "Deposit",
  "transfer",
  "Transfer",
  "DIVIDENT",
  "Dividend",
  "Dywidenda",
  "Swap",
  "swap",
  "Fee",
  "fee",
].sort((left, right) => right.length - left.length);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const XTB_TEXT_OPERATION_TYPE_PATTERN = XTB_TEXT_OPERATION_TYPES.map(escapeRegExp).join("|");

const normalizeXtbReportText = (text: string) =>
  text
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractXtbTextAccountMeta = (text: string) => {
  const match = text.match(/\bAccount\s+Currency\b[\s\S]{0,260}?\b(\d{6,})\s+(PLN|USD|EUR|GBP|CHF|DKK)\b/i);

  return {
    accountNumber: match?.[1] ?? "",
    accountCurrency: match?.[2] ?? "",
  };
};

const buildXtbRowsFromTextTable = (text: string) => {
  const normalizedText = normalizeXtbReportText(text);
  const tableStart = normalizedText.search(/CASH\s+OPERATION\s+HISTORY/i);

  if (tableStart < 0) {
    return null;
  }

  const tableText = normalizedText.slice(tableStart);
  const meta = extractXtbTextAccountMeta(normalizedText);
  const operationRegex = new RegExp(
    `\\b(\\d{6,})\\s+(${XTB_TEXT_OPERATION_TYPE_PATTERN})\\s+(\\d{2}\\/\\d{2}\\/\\d{4}\\s+\\d{2}:\\d{2}:\\d{2})\\s+([\\s\\S]*?)(?=\\s+\\d{6,}\\s+(?:${XTB_TEXT_OPERATION_TYPE_PATTERN})\\s+\\d{2}\\/\\d{2}\\/\\d{4}\\s+\\d{2}:\\d{2}:\\d{2}|\\s+Total\\b|$)`,
    "gi"
  );
  const rows: string[][] = [
    ["Account number", meta.accountNumber],
    ["Currency", meta.accountCurrency],
    ["ID", "Type", "Time", "Comment", "Symbol", "Amount"],
  ];

  Array.from(tableText.matchAll(operationRegex)).forEach((match) => {
    const payload = (match[4] ?? "").trim();
    const amountMatch = payload.match(/(-?\d+(?:[.,]\d+)?)\s*$/);

    if (!amountMatch || typeof amountMatch.index !== "number") {
      return;
    }

    const amount = amountMatch[1];
    const beforeAmount = payload.slice(0, amountMatch.index).trim();
    const symbolMatch = beforeAmount.match(/\b([A-Z0-9]{1,14}(?:\.[A-Z0-9]{1,5})?|BITCOIN)\s*$/);
    const symbol =
      symbolMatch && !["PAYU", "BLIK", "ADYEN"].includes(symbolMatch[1].toUpperCase())
        ? symbolMatch[1]
        : "";
    const comment =
      symbol && typeof symbolMatch?.index === "number"
        ? beforeAmount.slice(0, symbolMatch.index).trim()
        : beforeAmount;

    rows.push([
      match[1] ?? "",
      match[2] ?? "",
      match[3] ?? "",
      comment,
      symbol,
      amount,
    ]);
  });

  return rows.length > 3 ? rows : null;
};

const parseXtbCashOperationText = (
  text: string,
  sourceLabel: string
): BrokerImportParseResult | null => {
  const rows = buildXtbRowsFromTextTable(text);

  return rows ? parseXtbCashOperationRows(rows, sourceLabel) : null;
};

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const htmlToPlainText = (html: string) =>
  decodeHtmlEntities(
    html
      .replace(/<\/?(tr|table|div|p|br|h\d|td|th)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );

const decodeBase64Utf8 = (value: string) => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return textDecoder.decode(bytes);
};

const extractMhtmlText = (content: string) => {
  const boundary = content.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];
  const parts = boundary ? content.split(`--${boundary}`) : [content];
  const textParts: string[] = [];

  parts.forEach((part) => {
    const splitIndex = part.search(/\r?\n\r?\n/);

    if (splitIndex < 0) {
      return;
    }

    const headers = part.slice(0, splitIndex);
    const body = part.slice(splitIndex).replace(/^\r?\n\r?\n?/, "");
    const contentType = headers.match(/Content-Type:\s*([^;\r\n]+)/i)?.[1]?.trim().toLowerCase();
    const encoding = headers
      .match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1]
      ?.trim()
      .toLowerCase();

    if (contentType !== "text/html" && contentType !== "text/plain") {
      return;
    }

    if (encoding === "base64") {
      try {
        textParts.push(decodeBase64Utf8(body.replace(/\s+/g, "")));
      } catch {
        // Ignore malformed non-report parts.
      }
      return;
    }

    textParts.push(body);
  });

  return textParts
    .map((part) => (/<[a-z][\s\S]*>/i.test(part) ? htmlToPlainText(part) : part))
    .join("\n");
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

  let xtbResult: BrokerImportParseResult | null = null;
  const closedPositions: XtbClosedPosition[] = [];

  for (const worksheet of xtbWorksheetEntries) {
    const worksheetText = await readZipTextEntry(bytes, entriesByName, worksheet.entry.name);

    if (!worksheetText) {
      continue;
    }

    const rows = await parseWorksheetRows(worksheetText, sharedStrings);
    closedPositions.push(...parseXtbClosedPositionRows(rows));

    if (!xtbResult) {
      xtbResult = parseXtbCashOperationRows(rows, worksheet.sheetName);
    }

    await yieldToMainThread();
  }

  if (xtbResult) {
    const enrichedOperations = enrichXtbSalesWithClosedPositions(
      xtbResult.operations,
      closedPositions
    );

    return {
      ...xtbResult,
      operations: enrichedOperations,
      warnings: [
        ...(xtbResult.warnings ?? []),
        closedPositions.length > 0
          ? `XTB XLSX: odczytano ${closedPositions.length} zamknietych pozycji do weryfikacji wyniku zrealizowanego.`
          : "",
      ].filter(Boolean),
    };
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
  const xtbTableResult = parseXtbCashOperationText(extractedText, "PDF XTB");

  if (xtbTableResult) {
    return {
      ...xtbTableResult,
      warnings: [
        ...(xtbTableResult.warnings ?? []),
        "XTB PDF: raport zostal odczytany z tabeli CASH OPERATION HISTORY po dekompresji strumieni PDF.",
      ],
    };
  }

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

export const parseBrokerOperationsMhtml = (
  content: string,
  _preset: BrokerImportPreset = "xtb"
): BrokerImportParseResult => {
  void _preset;

  const extractedText = extractMhtmlText(content);
  const xtbTableResult = parseXtbCashOperationText(extractedText, "MHTML/HTML XTB");

  if (xtbTableResult) {
    return {
      ...xtbTableResult,
      warnings: [
        ...(xtbTableResult.warnings ?? []),
        "XTB MHTML/HTML: raport zostal odczytany z tabeli CASH OPERATION HISTORY.",
      ],
    };
  }

  return {
    operations: [],
    skippedRows: [
      {
        rowNumber: 1,
        reason: "Nie znaleziono tabeli CASH OPERATION HISTORY w raporcie HTML/MHTML XTB.",
      },
    ],
    warnings: [
      "Import HTML/MHTML XTB wymaga raportu z tekstowa tabela operacji gotowkowych.",
    ],
  };
};
