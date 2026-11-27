import { NextResponse } from "next/server";
import { getCfdQuoteSource } from "@/lib/cfd";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { fetchYahooDailyHistory } from "@/lib/server/yahoo";
import { fetchInstrumentCandles } from "@/lib/server/instrument-candles";
import { fetchInstrumentPriceHistory } from "@/lib/server/portfolio-history";
import { toCurrencyCode } from "@/lib/utils";
import type { AssetKind, QuoteProvider } from "@/types/portfolio";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_INSTRUMENTS = 8;
const PRICE_KINDS = new Set<AssetKind>(["stock", "etf", "crypto"]);
const PROVIDERS = new Set<QuoteProvider>(["binance", "finnhub", "stooq", "yahoo", "eodhd", "coingecko", "catalog"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A series starting this much later than another still counts as reaching as far back. */
const COVERAGE_TOLERANCE_DAYS = 30;

const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

type RequestItem = {
  key?: unknown;
  symbol?: unknown;
  kind?: unknown;
  marketCurrency?: unknown;
  provider?: unknown;
  providerId?: unknown;
  priceScale?: unknown;
  isCfd?: unknown;
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/**
 * Daily closes of the instruments the signed-in user looks at on the instrument chart, in each
 * instrument's quote currency. The same cached providers as the portfolio history are used, so a
 * holding already drawn there costs no new provider call. Treasury bonds have no market price and
 * are not served here.
 */
export async function POST(request: Request) {
  if (!(await getCurrentAuthenticatedUser())) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401, headers: NO_STORE });
  }

  let body: { instruments?: unknown; startDate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe zapytanie." }, { status: 400, headers: NO_STORE });
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = typeof body.startDate === "string" && DATE.test(body.startDate) ? body.startDate : "";
  if (!startDate || startDate < "2000-01-01" || startDate > today) {
    return NextResponse.json({ error: "Podaj datę początkową od 2000-01-01 do dziś." }, { status: 400, headers: NO_STORE });
  }
  if (!Array.isArray(body.instruments) || body.instruments.length === 0 || body.instruments.length > MAX_INSTRUMENTS) {
    return NextResponse.json({ error: `Wybierz od 1 do ${MAX_INSTRUMENTS} walorów.` }, { status: 400, headers: NO_STORE });
  }

  const instruments = (body.instruments as RequestItem[]).map((item) => {
    const kind = text(item?.kind, 10) as AssetKind;
    const provider = text(item?.provider, 20) as QuoteProvider;
    const priceScale = typeof item?.priceScale === "number" && Number.isFinite(item.priceScale) && item.priceScale > 0 ? item.priceScale : undefined;
    return {
      key: text(item?.key, 200),
      symbol: text(item?.symbol, 40),
      kind,
      marketCurrency: toCurrencyCode(text(item?.marketCurrency, 5), "USD"),
      provider: PROVIDERS.has(provider) ? provider : "catalog",
      providerId: text(item?.providerId, 120) || undefined,
      priceScale,
      isCfd: item?.isCfd === true,
    };
  });
  if (instruments.some((item) => !item.key || !item.symbol || !PRICE_KINDS.has(item.kind))) {
    return NextResponse.json({ error: "Każdy walor musi mieć klucz, symbol i typ: akcja, ETF lub kryptowaluta." }, { status: 400, headers: NO_STORE });
  }

  const inRange = (point: { date: string; close: number }) =>
    point.date >= startDate && point.date <= today && Number.isFinite(point.close) && point.close > 0;

  const series = await Promise.all(
    instruments.map(async ({ key, isCfd, ...definition }) => {
      if (isCfd) {
        // Searching by the CFD's ticker could draw another instrument that shares its letters.
        const source = getCfdQuoteSource({ instrumentType: "CFD", symbol: definition.symbol });
        const history = source ? await fetchYahooDailyHistory({ symbol: source.yahooSymbol, startDate, endDate: today }).catch(() => null) : null;
        const candles = history?.currency?.toUpperCase() === "USD" ? (history.candles ?? []).filter(inRange) : [];
        return { key, points: candles.map(({ date, close }) => ({ date, close })), candles };
      }
      const candles = (await fetchInstrumentCandles(definition, startDate, today)).filter(inRange);
      // Candles that start about when asked need no second source.
      if (candles.length > 1 && candles[0]!.date <= shiftDays(startDate, COVERAGE_TOLERANCE_DAYS)) {
        return { key, points: candles.map(({ date, close }) => ({ date, close })), candles };
      }
      const result = await fetchInstrumentPriceHistory({ ...definition, purchaseDate: startDate }, startDate, today);
      const points = result.points.filter(inRange);
      // A shorter Yahoo series is still used when no other source reaches further back.
      if (candles.length > 1 && (points.length === 0 || candles[0]!.date <= shiftDays(points[0]!.date, COVERAGE_TOLERANCE_DAYS))) {
        return { key, points: candles.map(({ date, close }) => ({ date, close })), candles };
      }
      return {
        key,
        points,
        ...(result.warning ? { warning: "Nie udało się pobrać historii notowań tego waloru." } : {}),
      };
    })
  );

  return NextResponse.json({ series }, { headers: NO_STORE });
}
