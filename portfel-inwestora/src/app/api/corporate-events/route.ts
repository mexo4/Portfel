import { NextResponse } from "next/server";
import {
  getCorporateEventsForGpwPortfolio,
  getGpwCorporateEventCanonicalKey,
  getGpwCorporateEventInputs,
} from "@/lib/server/corporate-events";
import {
  getCurrentAccountData,
  PortfolioRevisionConflictError,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import { ensurePortfolioCoreModel, getPortfolioInstrumentId } from "@/lib/operation-engine";
import {
  applyAutomaticGpwDividends,
  projectDividendEventsForPortfolios,
} from "@/lib/automatic-gpw-dividends";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import { getUserWatchlist, getWatchlistCorporateEventInputs } from "@/lib/server/watchlist";
import type { CorporateEvent } from "@/lib/corporate-events";
import type { InvestmentPortfolio, PortfolioBook } from "@/types/portfolio";

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

/**
 * Only the current open lots form a held universe.  `operations` is a
 * historical ledger, so including it here kept fully sold shares in the
 * corporate-event feed indefinitely.
 */
const getHeldGpwInstruments = (portfolios: InvestmentPortfolio[]) =>
  portfolios.flatMap((portfolio) => {
    const normalizedPortfolio = ensurePortfolioCoreModel(portfolio);
    const monitoredInstrumentIds = new Set(
      normalizedPortfolio.assets.map((asset) =>
        getPortfolioInstrumentId(normalizedPortfolio.id, asset)
      )
    );

    return getGpwCorporateEventInputs(
      normalizedPortfolio.instruments ?? [],
      monitoredInstrumentIds
    );
  });

const uniqueGpwInputs = <T extends Parameters<typeof getGpwCorporateEventCanonicalKey>[0]>(
  instruments: T[]
) =>
  Array.from(
    new Map(
      instruments.map((instrument) => [getGpwCorporateEventCanonicalKey(instrument), instrument])
    ).values()
  );

const getTrackedEventKey = (event: Pick<CorporateEvent, "ticker">) =>
  `gpw:ticker:${event.ticker.trim().toUpperCase().replace(/\.(WA|PL)$/, "")}`;

const projectTrackedEvents = ({
  events,
  heldInputs,
  watchlistInputs,
  portfolios,
  today,
}: {
  events: CorporateEvent[];
  heldInputs: Parameters<typeof getGpwCorporateEventCanonicalKey>[0][];
  watchlistInputs: Parameters<typeof getGpwCorporateEventCanonicalKey>[0][];
  portfolios: InvestmentPortfolio[];
  today: string;
}) => {
  const heldKeys = new Set(heldInputs.map(getGpwCorporateEventCanonicalKey));
  const watchedKeys = new Set(watchlistInputs.map(getGpwCorporateEventCanonicalKey));
  const heldEvents = projectDividendEventsForPortfolios({
    events: events.filter((event) => heldKeys.has(getTrackedEventKey(event))),
    portfolios,
    today,
  });
  const projectedById = new Map(heldEvents.map((event) => [event.id, event]));

  return events.map((event) => {
    const key = getTrackedEventKey(event);
    const projected = projectedById.get(event.id) ?? event;
    return {
      ...projected,
      trackingSource: heldKeys.has(key)
        ? watchedKeys.has(key)
          ? "HELD_AND_WATCHLIST"
          : "HELD"
        : "WATCHLIST",
    };
  });
};

const synchronizeAutomaticDividends = async ({
  initialBook,
  initialRevision,
  userId,
  events,
  today,
}: {
  initialBook: PortfolioBook;
  initialRevision: number;
  userId: string;
  events: CorporateEvent[];
  today: string;
}) => {
  let portfolioBook = initialBook;
  let portfolioRevision = initialRevision;
  let requiresPortfolioReload = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const application = applyAutomaticGpwDividends({
      portfolioBook,
      events,
      today,
    });

    if (application.addedCount === 0) {
      return {
        portfolioBook,
        addedCount: 0,
        manualMatchesCount: application.manualMatchesCount,
        requiresPortfolioReload,
      };
    }

    try {
      const updated = await updateCurrentUserPortfolio(
        userId,
        application.portfolioBook,
        portfolioRevision,
        { enforcePlanLimit: false }
      );
      return {
        portfolioBook: updated.portfolioBook,
        addedCount: application.addedCount,
        manualMatchesCount: application.manualMatchesCount,
        requiresPortfolioReload: true,
      };
    } catch (error) {
      if (!(error instanceof PortfolioRevisionConflictError) || attempt === 1) {
        // Corporate Events remain readable even when an unrelated concurrent
        // portfolio write postpones automatic posting until the next check.
        return {
          portfolioBook,
          addedCount: 0,
          manualMatchesCount: application.manualMatchesCount,
          requiresPortfolioReload,
        };
      }

      const latest = await getCurrentAccountData();
      if (!latest || latest.user.id !== userId) break;
      portfolioBook = normalizePortfolioBook({
        portfolios: latest.portfolios,
        activePortfolioId: latest.activePortfolioId,
      });
      portfolioRevision = latest.portfolioRevision;
      requiresPortfolioReload = true;
    }
  }

  return {
    portfolioBook,
    addedCount: 0,
    manualMatchesCount: 0,
    requiresPortfolioReload,
  };
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
  const initialBook = normalizePortfolioBook({
    portfolios: accountData.portfolios,
    activePortfolioId: accountData.activePortfolioId,
  });
  const portfolios = isAggregateRequest
    ? initialBook.portfolios
    : initialBook.portfolios.filter(
        (candidate) => candidate.id === (requestedPortfolioId || accountData.activePortfolioId)
      );

  if (portfolios.length === 0) {
    return NextResponse.json({ error: "Nie znaleziono portfela." }, { status: 404 });
  }

  const [watchlist,] = await Promise.all([getUserWatchlist(accountData.user.id)]);
  const heldInstruments = getHeldGpwInstruments(portfolios);
  const watchlistInstruments = getWatchlistCorporateEventInputs(watchlist);
  const instruments = uniqueGpwInputs(
    [...heldInstruments, ...watchlistInstruments]
      .filter((instrument) => !requestedInstrumentId || instrument.id === requestedInstrumentId)
  );
  const fromDate = getWarsawDate();
  const days = getDays(searchParams.get("days"));

  try {
    const result = await getCorporateEventsForGpwPortfolio({
      instruments,
      fromDate,
      toDate: addDays(fromDate, days),
    });
    // Watchlist rows are informational only. They never participate in the
    // automatic dividend posting path, which is intentionally based on open
    // holdings from the real portfolio ledger.
    const automaticInstruments = uniqueGpwInputs(getHeldGpwInstruments(initialBook.portfolios));
    const payableEvents = automaticInstruments.length > 0
      ? await getCorporateEventsForGpwPortfolio({
          instruments: automaticInstruments,
          fromDate: addDays(fromDate, -550),
          toDate: fromDate,
          eventTypes: ["UPCOMING_DIVIDEND"],
        })
      : { events: [] };
    const synchronization = await synchronizeAutomaticDividends({
      initialBook,
      initialRevision: accountData.portfolioRevision,
      userId: accountData.user.id,
      events: payableEvents.events,
      today: fromDate,
    });
    const projectedPortfolios = isAggregateRequest
      ? synchronization.portfolioBook.portfolios
      : synchronization.portfolioBook.portfolios.filter(
          (candidate) => candidate.id === (requestedPortfolioId || synchronization.portfolioBook.activePortfolioId)
        );
    const projectedEvents = projectTrackedEvents({
      events: result.events,
      heldInputs: uniqueGpwInputs(heldInstruments),
      watchlistInputs: uniqueGpwInputs(watchlistInstruments),
      portfolios: projectedPortfolios,
      today: fromDate,
    });

    return NextResponse.json({
      ...result,
      events: projectedEvents,
      automaticPosting: {
        addedCount: synchronization.addedCount,
        manualMatchesCount: synchronization.manualMatchesCount,
        requiresPortfolioReload: synchronization.requiresPortfolioReload,
      },
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
