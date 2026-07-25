import db from "@/lib/server/db";
import {
  addUtcYears,
  clampBondFee,
  createFallbackTreasuryBondSeries,
  getBondPeriodEndDate,
  getBondPeriodStartDate,
  getBondQuoteAccrual,
  getBondReferenceMonthKey,
  getDaysBetweenDates,
  getDaysInBondPeriod,
  getTreasuryBondMaturityDate,
  getTreasuryBondOfferUrl,
  isTreasuryBondPurchaseDateInIssueWindow,
  shiftBondDateByDays,
} from "@/lib/treasury-bonds";
import { normalizeSymbol } from "@/lib/ticker";
import { round, toDateInputValue } from "@/lib/utils";
import type {
  BondRedemptionQuote,
  BondSwapQuote,
  TreasuryBondQuote,
  TreasuryBondRateEntry,
  TreasuryBondSeries,
} from "@/types/portfolio";

type CacheRow = {
  payload_json: string;
  updated_at: string;
};

type GusDataPoint = {
  val?: number | null;
  values?: Array<number | null>;
};

type GusDataResponse = {
  results?: Array<GusDataPoint>;
  data?: Array<GusDataPoint>;
};

type BondQuoteSnapshot = {
  price: number;
  previousClose?: number;
  annualRate: number;
  grossInterest: number;
  currentPeriodInterest: number;
  maturityDate: string;
  couponPaymentDate?: string;
  rateSchedule: TreasuryBondRateEntry[];
};

const SERIES_CACHE_PREFIX = "treasury-bond-series-v1:";
const CPI_CACHE_PREFIX = "treasury-bond-cpi-v1:";
const SERIES_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CPI_CACHE_TTL_MS = 31 * 24 * 60 * 60 * 1_000;
const GUS_VARIABLE_CANDIDATES = [2955, 2496];
const POLAND_UNIT_LEVEL = 0;
const POLISH_TAX_RATE = 0.19;
const readCacheStatement = db.prepare(
  "SELECT payload_json, updated_at FROM market_cache WHERE key = ?"
);
const writeCacheStatement = db.prepare(`
  INSERT INTO market_cache (key, payload_json, updated_at)
  VALUES (@key, @payloadJson, @updatedAt)
  ON CONFLICT(key) DO UPDATE SET
    payload_json = excluded.payload_json,
    updated_at = excluded.updated_at
`);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getCachedPayload = <T,>(key: string, ttlMs: number) => {
  const row = readCacheStatement.get(key) as CacheRow | undefined;

  if (!row?.payload_json) {
    return null;
  }

  const updatedAt = Date.parse(row.updated_at);

  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > ttlMs) {
    return null;
  }

  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
};

const setCachedPayload = (key: string, payload: unknown) => {
  writeCacheStatement.run({
    key,
    payloadJson: JSON.stringify(payload),
    updatedAt: new Date().toISOString(),
  });
};

const safeFetchText = async (url: string, timeoutMs = 15_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html, text/plain, application/pdf",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const safeFetchJson = async <T,>(url: string, timeoutMs = 15_000): Promise<T | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const toJinaProxyUrl = (url: string) => {
  const parsedUrl = new URL(url);
  return `https://r.jina.ai/http://${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}`;
};

const fetchOfficialText = async (url: string) => {
  if (/\.pdf(\?|$)/i.test(url)) {
    return safeFetchText(toJinaProxyUrl(url), 20_000);
  }

  const directContent = await safeFetchText(url, 20_000);

  if (directContent) {
    return directContent;
  }

  return safeFetchText(toJinaProxyUrl(url), 20_000);
};

const normalizeDocumentText = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseDecimal = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const getAbsoluteUrl = (baseUrl: string, href: string) => {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
};

const findLinkedResourceUrl = (
  html: string,
  baseUrl: string,
  labelPattern: RegExp,
  hrefPattern?: RegExp
) => {
  const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(linkPattern)) {
    const href = match[1]?.trim();
    const label = normalizeDocumentText(match[2] ?? "");

    if (!href || !labelPattern.test(label)) {
      continue;
    }

    if (hrefPattern && !hrefPattern.test(href)) {
      continue;
    }

    return getAbsoluteUrl(baseUrl, href);
  }

  return undefined;
};

const parseSeriesMetadata = async (code: string) => {
  const offerPageUrl = getTreasuryBondOfferUrl(code);
  const offerHtml = await fetchOfficialText(offerPageUrl);
  const fallbackSeries = createFallbackTreasuryBondSeries(code);

  if (!offerHtml) {
    return fallbackSeries;
  }

  const offerText = normalizeDocumentText(offerHtml);
  const letterUrl =
    findLinkedResourceUrl(offerHtml, offerPageUrl, /list emisyjny/i, /\.pdf$/i) ??
    undefined;
  const interestTableUrl =
    findLinkedResourceUrl(offerHtml, offerPageUrl, /tabel[ae]\s+odsetkow/i) ?? undefined;
  const letterText = letterUrl ? await fetchOfficialText(letterUrl) : null;
  const normalizedLetterText = letterText ? normalizeDocumentText(letterText) : "";
  const fullText = [offerText, normalizedLetterText].filter(Boolean).join(" ");
  const firstYearRate =
    parseDecimal(
      fullText.match(/W pierwszym okresie odsetkowym stopa procentowa wynosi ([\d,.]+)%/i)?.[1]
    ) ??
    parseDecimal(
      fullText.match(/Oprocentowanie:\s*([\d,.]+)%/i)?.[1]
    ) ??
    fallbackSeries.firstYearRate;
  const marginRate =
    parseDecimal(
      fullText.match(/sta[łl]a marż[ae]\s+w wysoko[śs]ci\s+([\d,.]+)%/i)?.[1]
    ) ??
    parseDecimal(
      fullText.match(/marż[ae]\s+([\d,.]+)%\s*\+\s*inflacja/i)?.[1]
    ) ??
    fallbackSeries.marginRate;
  const earlyRedemptionFee =
    parseDecimal(
      fullText.match(/nie wyższ[ay]\s+niż\s+([\d,.]+)\s*zł/i)?.[1]
    ) ?? fallbackSeries.earlyRedemptionFee;
  const salePrice =
    parseDecimal(
      fullText.match(/Cena sprzedaży jednej obligacji:\s*([\d,.]+)\s*zł/i)?.[1]
    ) ?? fallbackSeries.salePrice;
  const swapPrice =
    parseDecimal(
      fullText.match(/Cena zamiany jednej obligacji:\s*([\d,.]+)\s*zł/i)?.[1]
    ) ?? undefined;
  const interestPaymentDescription =
    fullText.match(/Odsetki:\s*([^:]+?)(?: Charakterystyka| Pozostałe informacje| Kto może kupić|$)/i)?.[1]?.trim() ??
    fallbackSeries.interestPaymentDescription;

  return {
    ...fallbackSeries,
    salePrice,
    swapPrice,
    firstYearRate,
    marginRate,
    earlyRedemptionFee,
    interestPaymentDescription,
    sourceLinks: {
      offerPageUrl,
      interestTableUrl,
      letterUrl,
    },
    resolvedAt: new Date().toISOString(),
  } satisfies TreasuryBondSeries;
};

const parseInflationResponseValue = (payload: GusDataResponse | null) => {
  if (!payload) {
    return null;
  }

  const directValue = payload.results?.find((entry) => isFiniteNumber(entry.val))?.val;

  if (isFiniteNumber(directValue)) {
    return directValue > 30 ? round(directValue - 100, 2) : round(directValue, 2);
  }

  const valueFromArray = payload.data?.flatMap((entry) => entry.values ?? []).find(isFiniteNumber);

  if (isFiniteNumber(valueFromArray)) {
    return valueFromArray > 30 ? round(valueFromArray - 100, 2) : round(valueFromArray, 2);
  }

  return null;
};

const fetchInflationRateForMonth = async (referenceMonth: string) => {
  const cacheKey = `${CPI_CACHE_PREFIX}${referenceMonth}`;
  const cachedValue = getCachedPayload<number>(cacheKey, CPI_CACHE_TTL_MS);

  if (cachedValue !== null) {
    return cachedValue;
  }

  const [year] = referenceMonth.split("-");
  let resolvedValue: number | null = null;

  for (const variableId of GUS_VARIABLE_CANDIDATES) {
    const payload = await safeFetchJson<GusDataResponse>(
      `https://bdl.stat.gov.pl/api/v1/data/by-variable/${variableId}?year=${encodeURIComponent(year)}&unit-level=${POLAND_UNIT_LEVEL}&format=json`,
      12_000
    );
    const parsedValue = parseInflationResponseValue(payload);

    if (parsedValue !== null) {
      resolvedValue = Math.max(0, parsedValue);
      break;
    }
  }

  const finalValue = resolvedValue ?? 0;
  setCachedPayload(cacheKey, finalValue);
  return finalValue;
};

const buildRateSchedule = async (series: TreasuryBondSeries) => {
  if (series.rateSchedule?.length === series.yearsToMaturity) {
    return series.rateSchedule;
  }

  const referenceStartDate = `${series.issueYear}-${String(series.issueMonth).padStart(2, "0")}-01`;
  const rateSchedule: TreasuryBondRateEntry[] = [
    {
      yearIndex: 1,
      annualRate: round(series.firstYearRate, 4),
      source: "official",
    },
  ];

  for (let yearIndex = 2; yearIndex <= series.yearsToMaturity; yearIndex += 1) {
    const periodStartDate = addUtcYears(referenceStartDate, yearIndex - 1);
    const referenceMonth = getBondReferenceMonthKey(periodStartDate);
    const inflationRate = await fetchInflationRateForMonth(referenceMonth);
    const annualRate = round(Math.max(0, inflationRate) + series.marginRate, 4);

    rateSchedule.push({
      yearIndex,
      annualRate,
      referenceMonth,
      inflationRate,
      source: inflationRate > 0 ? "inflation" : "fallback",
    });
  }

  return rateSchedule;
};

export const resolveTreasuryBondSeries = async (code: string) => {
  const normalizedCode = normalizeSymbol(code);
  const cacheKey = `${SERIES_CACHE_PREFIX}${normalizedCode}`;
  const cachedSeries = getCachedPayload<TreasuryBondSeries>(cacheKey, SERIES_CACHE_TTL_MS);

  if (cachedSeries) {
    return cachedSeries;
  }

  const baseSeries = await parseSeriesMetadata(normalizedCode);
  const rateSchedule = await buildRateSchedule(baseSeries);
  const resolvedSeries = {
    ...baseSeries,
    rateSchedule,
    resolvedAt: new Date().toISOString(),
  } satisfies TreasuryBondSeries;

  setCachedPayload(cacheKey, resolvedSeries);
  return resolvedSeries;
};

const getRateForYear = (series: TreasuryBondSeries, yearIndex: number) =>
  series.rateSchedule?.find((entry) => entry.yearIndex === yearIndex)?.annualRate ??
  (yearIndex === 1 ? series.firstYearRate : round(series.marginRate, 4));

const calculateBondQuoteSnapshot = ({
  series,
  purchaseDate,
  asOfDate,
}: {
  series: TreasuryBondSeries;
  purchaseDate: string;
  asOfDate: string;
}): BondQuoteSnapshot => {
  const normalizedPurchaseDate = toDateInputValue(purchaseDate);
  const normalizedAsOfDate =
    toDateInputValue(asOfDate, normalizedPurchaseDate) < normalizedPurchaseDate
      ? normalizedPurchaseDate
      : toDateInputValue(asOfDate, normalizedPurchaseDate);
  const maturityDate = getTreasuryBondMaturityDate(
    normalizedPurchaseDate,
    series.yearsToMaturity
  );
  const cappedAsOfDate = normalizedAsOfDate > maturityDate ? maturityDate : normalizedAsOfDate;
  const rateSchedule = series.rateSchedule ?? [];
  let baseAmount = series.nominalValue;
  let price = series.nominalValue;
  let grossInterest = 0;
  let currentPeriodInterest = 0;
  let annualRate = getRateForYear(series, 1);
  let couponPaymentDate: string | undefined;

  for (let yearIndex = 1; yearIndex <= series.yearsToMaturity; yearIndex += 1) {
    const periodStartDate = getBondPeriodStartDate(normalizedPurchaseDate, yearIndex);
    const periodEndDate = getBondPeriodEndDate(normalizedPurchaseDate, yearIndex);
    const periodDays = getDaysInBondPeriod(periodStartDate, periodEndDate);
    annualRate = getRateForYear(series, yearIndex);
    const fullInterest = round(baseAmount * (annualRate / 100), 8);

    if (cappedAsOfDate >= periodEndDate) {
      if (series.couponMode === "capitalized") {
        baseAmount = round(baseAmount + fullInterest, 8);
        price = baseAmount;
        grossInterest = round(price - series.nominalValue, 8);
        currentPeriodInterest = 0;
      } else if (yearIndex < series.yearsToMaturity) {
        couponPaymentDate = periodEndDate;
        price = series.nominalValue;
        grossInterest = 0;
        currentPeriodInterest = 0;
      } else {
        price = round(series.nominalValue + fullInterest, 8);
        grossInterest = fullInterest;
        currentPeriodInterest = fullInterest;
      }

      continue;
    }

    const elapsedDays = getDaysBetweenDates(periodStartDate, cappedAsOfDate);
    const accruedInterest = getBondQuoteAccrual({
      baseAmount,
      annualRate,
      elapsedDays,
      periodDays,
    });

    currentPeriodInterest = accruedInterest;

    if (series.couponMode === "capitalized") {
      price = round(baseAmount + accruedInterest, 8);
      grossInterest = round(price - series.nominalValue, 8);
    } else {
      price = round(series.nominalValue + accruedInterest, 8);
      grossInterest = accruedInterest;
      couponPaymentDate = yearIndex < series.yearsToMaturity ? periodEndDate : undefined;
    }

    return {
      price,
      annualRate,
      previousClose: undefined,
      grossInterest,
      currentPeriodInterest,
      maturityDate,
      couponPaymentDate,
      rateSchedule,
    };
  }

  return {
    price,
    annualRate,
    previousClose: undefined,
    grossInterest,
    currentPeriodInterest,
    maturityDate,
    couponPaymentDate,
    rateSchedule,
  };
};

export const fetchTreasuryBondQuoteServer = async ({
  code,
  purchaseDate,
  asOfDate = toDateInputValue(new Date().toISOString()),
}: {
  code: string;
  purchaseDate: string;
  asOfDate?: string;
}): Promise<TreasuryBondQuote> => {
  const series = await resolveTreasuryBondSeries(code);
  const snapshot = calculateBondQuoteSnapshot({
    series,
    purchaseDate,
    asOfDate,
  });
  const previousDate = shiftBondDateByDays(asOfDate, -1);
  const previousSnapshot = calculateBondQuoteSnapshot({
    series,
    purchaseDate,
    asOfDate: previousDate,
  });

  return {
    symbol: series.code,
    code: series.code,
    type: series.type,
    price: round(snapshot.price, 6),
    grossValue: round(snapshot.price, 6),
    grossInterest: round(snapshot.grossInterest, 6),
    currentPeriodInterest: round(snapshot.currentPeriodInterest, 6),
    annualRate: round(snapshot.annualRate, 4),
    previousClose: round(previousSnapshot.price, 6),
    maturityDate: snapshot.maturityDate,
    couponPaymentDate: snapshot.couponPaymentDate,
    marketCurrency: "PLN",
    provider: "obligacjeskarbowe",
    fetchedAt: new Date().toISOString(),
    bondMeta: {
      ...series,
      rateSchedule: snapshot.rateSchedule,
    },
  };
};

export const fetchTreasuryBondQuoteSeriesServer = async ({
  code,
  purchaseDate,
  startDate,
  endDate = toDateInputValue(new Date().toISOString()),
}: {
  code: string;
  purchaseDate: string;
  startDate: string;
  endDate?: string;
}) => {
  const normalizedPurchaseDate = toDateInputValue(purchaseDate);
  const normalizedStartDate = toDateInputValue(startDate, normalizedPurchaseDate);
  const normalizedEndDate = toDateInputValue(endDate, normalizedStartDate);

  if (normalizedEndDate < normalizedStartDate) {
    return [];
  }

  const series = await resolveTreasuryBondSeries(code);
  const points: Array<{ date: string; price: number }> = [];

  for (
    let cursor = normalizedStartDate;
    cursor <= normalizedEndDate;
    cursor = shiftBondDateByDays(cursor, 1)
  ) {
    const snapshot = calculateBondQuoteSnapshot({
      series,
      purchaseDate: normalizedPurchaseDate,
      asOfDate: cursor,
    });

    points.push({
      date: cursor,
      price: round(snapshot.price, 6),
    });
  }

  return points;
};

const getEasterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const getPolishHolidays = (year: number) => {
  const easterSunday = getEasterSunday(year);
  const easterMonday = shiftBondDateByDays(easterSunday, 1);
  const corpusChristi = shiftBondDateByDays(easterSunday, 60);

  return new Set([
    `${year}-01-01`,
    `${year}-01-06`,
    `${year}-05-01`,
    `${year}-05-03`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`,
    `${year}-12-26`,
    easterMonday,
    corpusChristi,
  ]);
};

const isBusinessDay = (date: string) => {
  const utcDate = new Date(`${date}T00:00:00.000Z`);
  const day = utcDate.getUTCDay();

  if (day === 0 || day === 6) {
    return false;
  }

  return !getPolishHolidays(utcDate.getUTCFullYear()).has(date);
};

const addBusinessDays = (date: string, businessDays: number) => {
  let cursor = toDateInputValue(date);
  let remainingDays = businessDays;

  while (remainingDays > 0) {
    cursor = shiftBondDateByDays(cursor, 1);

    if (isBusinessDay(cursor)) {
      remainingDays -= 1;
    }
  }

  return cursor;
};

export const fetchTreasuryBondRedemptionQuoteServer = async ({
  code,
  purchaseDate,
  quantity,
  requestDate,
}: {
  code: string;
  purchaseDate: string;
  quantity: number;
  requestDate: string;
}): Promise<BondRedemptionQuote> => {
  const normalizedQuantity = round(quantity, 6);

  if (normalizedQuantity <= 0) {
    throw new Error("Podaj ilosc obligacji do wykupu.");
  }

  const normalizedPurchaseDate = toDateInputValue(purchaseDate);
  const normalizedRequestDate = toDateInputValue(requestDate);

  if (normalizedRequestDate < normalizedPurchaseDate) {
    throw new Error("Data dyspozycji wykupu nie moze byc wczesniejsza niz data zakupu.");
  }

  if (getDaysBetweenDates(normalizedPurchaseDate, normalizedRequestDate) < 7) {
    throw new Error("Dyspozycje wykupu mozna zlozyc najwczesniej po 7 dniach od zakupu.");
  }

  const settlementDate = addBusinessDays(normalizedRequestDate, 5);
  const settlementQuote = await fetchTreasuryBondQuoteServer({
    code,
    purchaseDate,
    asOfDate: settlementDate,
  });
  const isMatured = settlementDate >= settlementQuote.maturityDate;
  const grossInterestBase =
    settlementQuote.bondMeta.couponMode === "capitalized"
      ? Math.max(0, settlementQuote.grossInterest)
      : Math.max(0, settlementQuote.currentPeriodInterest);
  const feePerUnit = isMatured
    ? 0
    : clampBondFee(grossInterestBase, settlementQuote.bondMeta.earlyRedemptionFee);
  const taxableInterestPerUnit = Math.max(0, grossInterestBase - feePerUnit);
  const taxPerUnit = round(taxableInterestPerUnit * POLISH_TAX_RATE, 8);
  const netValuePerUnit = round(settlementQuote.grossValue - feePerUnit - taxPerUnit, 8);

  return {
    code: settlementQuote.code,
    quantity: normalizedQuantity,
    requestDate: toDateInputValue(requestDate),
    settlementDate,
    maturityDate: settlementQuote.maturityDate,
    grossValuePerUnit: round(settlementQuote.grossValue, 6),
    grossValueTotal: round(settlementQuote.grossValue * normalizedQuantity, 2),
    grossInterestPerUnit: round(grossInterestBase, 6),
    grossInterestTotal: round(grossInterestBase * normalizedQuantity, 2),
    annualRate: settlementQuote.annualRate,
    feePerUnit: round(feePerUnit, 6),
    feeTotal: round(feePerUnit * normalizedQuantity, 2),
    taxableInterestPerUnit: round(taxableInterestPerUnit, 6),
    taxableInterestTotal: round(taxableInterestPerUnit * normalizedQuantity, 2),
    taxPerUnit: round(taxPerUnit, 6),
    taxTotal: round(taxPerUnit * normalizedQuantity, 2),
    netValuePerUnit: round(netValuePerUnit, 6),
    netValueTotal: round(netValuePerUnit * normalizedQuantity, 2),
    marketCurrency: "PLN",
    transactionKind: "bond-redemption",
  };
};

const getBondSwapPrice = (series: TreasuryBondSeries) =>
  round(
    series.swapPrice ??
      Math.max(0, round((series.salePrice ?? series.nominalValue) - 0.1, 2)),
    2
  );

export const fetchTreasuryBondSwapQuoteServer = async ({
  sourceRedemption,
  targetCode,
  targetQuantity,
}: {
  sourceRedemption: BondRedemptionQuote;
  targetCode: string;
  targetQuantity: number;
}): Promise<BondSwapQuote> => {
  const normalizedTargetQuantity = round(targetQuantity, 6);

  if (normalizedTargetQuantity <= 0) {
    throw new Error("Podaj ilosc obligacji po zamianie.");
  }
  const settlementDate = sourceRedemption.settlementDate;
  const resolvedTargetCode = normalizeSymbol(targetCode);

  if (!resolvedTargetCode) {
    throw new Error("Podaj kod docelowej obligacji.");
  }

  if (!isTreasuryBondPurchaseDateInIssueWindow(resolvedTargetCode, settlementDate)) {
    throw new Error(
      "Docelowa seria musi byc dostepna w miesiacu rozliczenia zamiany."
    );
  }

  const [targetSeries, targetQuote] = await Promise.all([
    resolveTreasuryBondSeries(resolvedTargetCode),
    fetchTreasuryBondQuoteServer({
      code: resolvedTargetCode,
      purchaseDate: settlementDate,
      asOfDate: settlementDate,
    }),
  ]);
  const swapPricePerUnit = getBondSwapPrice(targetSeries);
  const swapPurchaseTotal = round(swapPricePerUnit * normalizedTargetQuantity, 2);
  const residualCashPln = round(sourceRedemption.netValueTotal - swapPurchaseTotal, 2);

  if (residualCashPln < 0) {
    throw new Error("Srodki z wykupu nie wystarczaja na wskazana ilosc obligacji po zamianie.");
  }

  return {
    sourceCode: sourceRedemption.code,
    targetCode: targetSeries.code,
    sourceQuantity: sourceRedemption.quantity,
    targetQuantity: normalizedTargetQuantity,
    requestDate: sourceRedemption.requestDate,
    settlementDate,
    sourceRedemption,
    targetSeries: {
      ...targetSeries,
      swapPrice: swapPricePerUnit,
    },
    targetQuote,
    swapPricePerUnit,
    swapPurchaseTotal,
    residualCashPln,
    marketCurrency: "PLN",
    transactionKind: "bond-swap",
  };
};
