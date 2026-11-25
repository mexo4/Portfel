import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { fetchInstrumentPriceHistory } from "@/lib/server/portfolio-history";
import { toCurrencyCode } from "@/lib/utils";
import type { AssetKind, QuoteProvider } from "@/types/portfolio";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_INSTRUMENTS = 8;
const PRICE_KINDS = new Set<AssetKind>(["stock", "etf", "crypto"]);
const PROVIDERS = new Set<QuoteProvider>(["binance", "finnhub", "stooq", "yahoo", "eodhd", "coingecko", "catalog"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type RequestItem = {
  key?: unknown;
  symbol?: unknown;
  kind?: unknown;
  marketCurrency?: unknown;
  provider?: unknown;
  providerId?: unknown;
  priceScale?: unknown;
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
    };
  });
  if (instruments.some((item) => !item.key || !item.symbol || !PRICE_KINDS.has(item.kind))) {
    return NextResponse.json({ error: "Każdy walor musi mieć klucz, symbol i typ: akcja, ETF lub kryptowaluta." }, { status: 400, headers: NO_STORE });
  }

  const series = await Promise.all(
    instruments.map(async ({ key, ...definition }) => {
      const result = await fetchInstrumentPriceHistory({ ...definition, purchaseDate: startDate }, startDate, today);
      return {
        key,
        points: result.points.filter((point) => point.date >= startDate && point.date <= today && Number.isFinite(point.close) && point.close > 0),
        ...(result.warning ? { warning: "Nie udało się pobrać historii notowań tego waloru." } : {}),
      };
    })
  );

  return NextResponse.json({ series }, { headers: NO_STORE });
}
