import { getUpcomingDividendRelevantDate, type CorporateEvent, type CorporateEventsResponse } from "@/lib/corporate-events";
import { getAssetClassAllocation, getGeographicAllocation } from "@/lib/geographic-allocation";
import { buildPortfolioDailyMetricPoints } from "@/lib/portfolio-daily-metrics";
import { calculateCapitalReturnPercent } from "@/lib/portfolio-performance";
import type { PortfolioAssetGroup } from "@/lib/pricing";
import { getGpwWatchlistCanonicalKey, type WatchlistItem } from "@/lib/watchlist";
import type { InvestmentPortfolio, PortfolioHistoryResponse, PortfolioOperation } from "@/types/portfolio";

export type DashboardOperationRow = {
  operation: PortfolioOperation;
  portfolioName: string;
  instrumentName?: string;
  instrumentSymbol?: string;
};

export const getDashboardRankedGroups = (
  groups: PortfolioAssetGroup[],
  direction: "value" | "gains" | "losses",
  limit = 5
) => [...groups]
  .filter((group) => direction === "gains" ? group.profitLossBase > 0 : direction === "losses" ? group.profitLossBase < 0 : true)
  .sort((left, right) => direction === "value"
    ? right.totalValue - left.totalValue
    : direction === "gains"
      ? right.profitLossBase - left.profitLossBase
      : left.profitLossBase - right.profitLossBase)
  .slice(0, limit);

const buildDashboardConcentration = (
  groups: PortfolioAssetGroup[],
  classes: ReturnType<typeof getAssetClassAllocation>,
  geography: ReturnType<typeof getGeographicAllocation>,
  totalPortfolioValue = groups.reduce((sum, group) => sum + group.totalValue, 0)
) => {
  const sorted = getDashboardRankedGroups(groups, "value", groups.length);
  const total = totalPortfolioValue;
  const percent = (value: number) => total > 0 ? (value / total) * 100 : 0;
  return {
    largest: sorted[0] ? { label: sorted[0].name, percent: percent(sorted[0].totalValue) } : null,
    topThreePercent: percent(sorted.slice(0, 3).reduce((sum, group) => sum + group.totalValue, 0)),
    dominantClass: classes[0] ? { label: classes[0].label, percent: percent(classes[0].totalValue) } : null,
    dominantGeography: geography[0] ? { label: geography[0].country, percent: percent(geography[0].totalValue) } : null,
  };
};

export const getDashboardConcentration = (groups: PortfolioAssetGroup[]) =>
  buildDashboardConcentration(groups, getAssetClassAllocation(groups), getGeographicAllocation(groups));

export const getDashboardOperations = (
  portfolios: Array<Pick<InvestmentPortfolio, "name" | "operations" | "instruments">>,
  predicate: (operation: PortfolioOperation) => boolean = () => true,
  limit = 6
): DashboardOperationRow[] => portfolios
  .flatMap((portfolio) => {
    const instrumentsById = new Map((portfolio.instruments ?? []).map((instrument) => [instrument.id, instrument]));
    return (portfolio.operations ?? []).map((operation) => {
      const instrument = operation.assetId ? instrumentsById.get(operation.assetId) : undefined;
      return {
        operation,
        portfolioName: portfolio.name,
        instrumentName: instrument?.name,
        instrumentSymbol: instrument?.symbol,
      };
    });
  })
  .filter(({ operation }) => predicate(operation))
  .sort((left, right) => right.operation.date.localeCompare(left.operation.date))
  .slice(0, limit);

export const getDashboardUpcomingEvents = (events: CorporateEvent[], limit = 6) => {
  const byIdentity = new Map<string, CorporateEvent>();
  events.forEach((event) => {
    if (event.active === false || event.status === "CANCELLED") return;
    const date = event.eventType === "UPCOMING_DIVIDEND" ? getUpcomingDividendRelevantDate(event) : event.eventDate;
    if (!date) return;
    const key = event.eventType === "GENERAL_MEETING"
      ? `${event.instrumentId}:${event.eventType}:${event.id}`
      : `${event.instrumentId}:${event.eventType}:${event.fiscalPeriod ?? event.dividendInstallment ?? ""}:${event.fiscalYear ?? ""}`;
    const current = byIdentity.get(key);
    const currentDate = current?.eventType === "UPCOMING_DIVIDEND" ? getUpcomingDividendRelevantDate(current) : current?.eventDate;
    if (!current || date < (currentDate ?? "9999-12-31")) byIdentity.set(key, event);
  });
  return Array.from(byIdentity.values())
    .sort((left, right) => {
      const leftDate = left.eventType === "UPCOMING_DIVIDEND" ? getUpcomingDividendRelevantDate(left) : left.eventDate;
      const rightDate = right.eventType === "UPCOMING_DIVIDEND" ? getUpcomingDividendRelevantDate(right) : right.eventDate;
      return (leftDate ?? "").localeCompare(rightDate ?? "") || left.companyName.localeCompare(right.companyName, "pl");
    })
    .slice(0, limit);
};

export const getDashboardHistoryMetrics = (
  history: PortfolioHistoryResponse | null,
  fallbackProfitLoss = 0,
  fallbackInvested = 0
) => {
  const points = history?.points ?? [];
  const dailyPoints = buildPortfolioDailyMetricPoints(points);
  const latest = dailyPoints.at(-1) ?? null;
  const latestPoint = points.at(-1) ?? null;
  // The final history point is the canonical cash-flow-aware snapshot used by
  // analytics. Value, P/L and return on the dashboard must come from that one
  // point; mixing current open-position cost with cumulative realised P/L can
  // produce extreme percentages after sales or withdrawals.
  const currentCapitalReturn = latestPoint
    ? calculateCapitalReturnPercent(latestPoint.profitLossPln, latestPoint.netInvestedPln)
    : calculateCapitalReturnPercent(fallbackProfitLoss, fallbackInvested);
  return {
    points,
    dailyPoints,
    latest,
    latestPoint,
    benchmark: history?.benchmarkSeries[0] ?? null,
    returnPercent: currentCapitalReturn,
  };
};

/**
 * Builds every dashboard derivation once. React memoizes this value in the
 * provider and widgets only select fields from it.
 */
export const buildDashboardReadModel = ({
  history,
  events,
  watchlist,
  groups,
  portfolios,
  fallbackProfitLoss,
  fallbackInvested,
  cashValue = 0,
}: {
  history: PortfolioHistoryResponse | null;
  events: CorporateEventsResponse | null;
  watchlist: WatchlistItem[];
  groups: PortfolioAssetGroup[];
  portfolios: Array<Pick<InvestmentPortfolio, "name" | "operations" | "instruments">>;
  fallbackProfitLoss: number;
  fallbackInvested: number;
  cashValue?: number;
}) => {
  const historyMetrics = getDashboardHistoryMetrics(history, fallbackProfitLoss, fallbackInvested);
  const classes = [
    ...getAssetClassAllocation(groups),
    ...(cashValue !== 0 ? [{ id: "cash", label: "Gotówka", totalValue: cashValue }] : []),
  ].sort((left, right) => right.totalValue - left.totalValue || left.label.localeCompare(right.label, "pl"));
  const geography = getGeographicAllocation(groups);
  const totalPortfolioValue = groups.reduce((sum, group) => sum + group.totalValue, 0) + cashValue;
  const concentration = buildDashboardConcentration(
    groups,
    classes,
    geography,
    totalPortfolioValue
  );
  const current = getDashboardRankedGroups(groups, "value", 6);
  const largest = getDashboardRankedGroups(groups, "value", 5);
  const gains = getDashboardRankedGroups(groups, "gains", 5);
  const losses = getDashboardRankedGroups(groups, "losses", 5);
  const recent = [...groups].sort((left, right) => {
    const rightDate = Math.max(...right.lots.map((lot) => Date.parse(lot.createdAt)));
    const leftDate = Math.max(...left.lots.map((lot) => Date.parse(lot.createdAt)));
    return rightDate - leftDate;
  }).slice(0, 5);
  const allOperations = getDashboardOperations(portfolios, undefined, 6);
  const cashOperations = getDashboardOperations(portfolios, (operation) =>
    ["DEPOSIT", "WITHDRAW", "TRANSFER", "CONVERSION", "FEE", "TAX", "INTEREST", "CUSTOM"].includes(operation.operationType), 6);
  const dividendOperations = getDashboardOperations(portfolios, (operation) =>
    operation.operationType === "DIVIDEND", 6);
  const allEvents = events?.events ?? [];
  const reports = getDashboardUpcomingEvents(allEvents.filter((event) => event.eventType !== "UPCOMING_DIVIDEND"), 5);
  const dividends = getDashboardUpcomingEvents(allEvents.filter((event) => event.eventType === "UPCOMING_DIVIDEND"), 5);
  const watched = getDashboardUpcomingEvents(allEvents.filter((event) =>
    event.trackingSource === "WATCHLIST" || event.trackingSource === "HELD_AND_WATCHLIST"), 5);
  const timeline = getDashboardUpcomingEvents(allEvents, 7);
  const groupsByKey = new Map(groups.map((group) => [getGpwWatchlistCanonicalKey(group.symbol), group]));
  const watchlistRows = watchlist.map((item) => ({ item, group: groupsByKey.get(item.canonicalKey) }));
  const dailyGroups = groups.filter((group) => typeof group.dailyChangePercent === "number");
  const bestDaily = [...dailyGroups].sort((left, right) =>
    (right.dailyChangePercent ?? 0) - (left.dailyChangePercent ?? 0))[0] ?? null;
  const worstDaily = [...dailyGroups].sort((left, right) =>
    (left.dailyChangePercent ?? 0) - (right.dailyChangePercent ?? 0))[0] ?? null;

  return {
    history: historyMetrics,
    allocations: { classes, geography },
    concentration,
    positions: { current, largest, gains, losses, recent },
    operations: { all: allOperations, cash: cashOperations, dividends: dividendOperations },
    events: { timeline, reports, dividends, watched },
    watchlist: {
      items: watchlist,
      rows: watchlistRows,
      changedRows: watchlistRows.filter((row) => row.group?.hasDailyChange),
    },
    dailySnapshot: {
      latest: historyMetrics.latest,
      best: bestDaily,
      worst: worstDaily,
      // The current response exposes cumulative benchmark return only. Showing
      // it as a daily comparison would be misleading.
      benchmarkPercent: null as number | null,
    },
  };
};

export type DashboardReadModel = ReturnType<typeof buildDashboardReadModel>;
