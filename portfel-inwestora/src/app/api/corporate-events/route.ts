import { NextResponse } from "next/server";
import {
  getCorporateEventsForGpwPortfolio,
  getGpwCorporateEventInputs,
} from "@/lib/server/corporate-events";
import { getCurrentAccountData } from "@/lib/server/auth";
import { ensurePortfolioCoreModel, getPortfolioInstrumentId } from "@/lib/operation-engine";
import { getGpwTickerCore } from "@/lib/ticker";

export const runtime = "nodejs";

const getWarsawDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

const getDays = (value: string | null) => {
  const parsed = Number(value ?? 60);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 365) : 60;
};

export async function GET(request: Request) {
  const accountData = await getCurrentAccountData();
  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedPortfolioId = searchParams.get("portfolio")?.trim();
  const requestedInstrumentId = searchParams.get("instrumentId")?.trim();
  const isAggregateRequest = requestedPortfolioId === "all";
  const portfolios = isAggregateRequest
    ? accountData.portfolios
    : accountData.portfolios.filter(
        (candidate) => candidate.id === (requestedPortfolioId || accountData.activePortfolioId)
      );

  if (portfolios.length === 0) {
    return NextResponse.json({ error: "Nie znaleziono portfela." }, { status: 404 });
  }

  const instruments = portfolios
    .flatMap((portfolio) => {
      const normalizedPortfolio = ensurePortfolioCoreModel(portfolio);
      const heldInstrumentIds = new Set(
        normalizedPortfolio.assets.map((asset) =>
          getPortfolioInstrumentId(normalizedPortfolio.id, asset)
        )
      );
      return getGpwCorporateEventInputs(normalizedPortfolio.instruments ?? [], heldInstrumentIds);
    })
    .filter((instrument) => !requestedInstrumentId || instrument.id === requestedInstrumentId);
  const heldQuantityByInstrumentId = portfolios.reduce((quantities, portfolio) => {
    const normalizedPortfolio = ensurePortfolioCoreModel(portfolio);

    for (const asset of normalizedPortfolio.assets) {
      const instrumentId = getPortfolioInstrumentId(normalizedPortfolio.id, asset);
      quantities.set(
        instrumentId,
        (quantities.get(instrumentId) ?? 0) + asset.quantity
      );
    }

    return quantities;
  }, new Map<string, number>());
  const heldQuantityByGpwTicker = instruments.reduce((quantities, instrument) => {
    const key = getGpwTickerCore(instrument.symbol);
    quantities.set(
      key,
      (quantities.get(key) ?? 0) + (heldQuantityByInstrumentId.get(instrument.id) ?? 0)
    );
    return quantities;
  }, new Map<string, number>());
  const fromDate = getWarsawDate();
  const days = getDays(searchParams.get("days"));

  try {
    const result = await getCorporateEventsForGpwPortfolio({
      instruments,
      fromDate,
      toDate: addDays(fromDate, days),
    });

    return NextResponse.json({
      ...result,
      events: result.events.map((event) => ({
        ...event,
        heldQuantity: heldQuantityByGpwTicker.get(event.ticker) ?? 0,
      })),
      portfolioId: isAggregateRequest ? "all" : portfolios[0]!.id,
      fromDate,
      toDate: addDays(fromDate, days),
    });
  } catch (error) {
    console.error("GET /api/corporate-events failed", {
      portfolioId: isAggregateRequest ? "all" : portfolios[0]!.id,
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "Nie udało się pobrać wydarzeń korporacyjnych." },
      { status: 500 }
    );
  }
}
