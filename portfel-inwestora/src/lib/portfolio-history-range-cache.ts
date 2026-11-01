import { EMPTY_HISTORY_CACHE_TTL_MS } from "@/lib/server/portfolio-history-cache-policy";

export type HistoryRangePoint = { date: string };

export type HistoryRangeCachePayload<TPoint extends HistoryRangePoint> = {
  version: 1;
  startDate: string;
  endDate: string;
  fullRefreshAt: string;
  points: TPoint[];
};

export type HistoryRangeCacheEntry = {
  payload: unknown;
  updatedAt: string;
};

export type HistoryRangeCacheResolution<TPoint extends HistoryRangePoint> = {
  payload: HistoryRangeCachePayload<TPoint>;
  cacheStatus: "hit" | "tail" | "full" | "stale";
};

export const migrateLegacyHistoryRangeCache = <TPoint extends HistoryRangePoint>(
  cached: HistoryRangeCacheEntry | null | undefined,
  startDate: string,
  endDate: string,
): HistoryRangeCacheEntry | null => {
  if (!cached || !Array.isArray(cached.payload) || cached.payload.length === 0) return null;

  const points = (cached.payload as unknown[]).filter((point): point is TPoint => {
    if (!point || typeof point !== "object") return false;
    const date = (point as Partial<HistoryRangePoint>).date;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
  });
  if (points.length === 0) return null;

  return {
    updatedAt: cached.updatedAt,
    payload: {
      version: 1,
      startDate,
      endDate,
      fullRefreshAt: cached.updatedAt,
      points,
    } satisfies HistoryRangeCachePayload<TPoint>,
  };
};

const MAX_INCREMENTAL_REFRESH_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const OVERLAP_DAYS = 7;

const shiftDate = (date: string, days: number) => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const isHistoryRangePayload = <TPoint extends HistoryRangePoint>(
  value: unknown,
): value is HistoryRangeCachePayload<TPoint> => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<HistoryRangeCachePayload<TPoint>>;
  return payload.version === 1 &&
    typeof payload.startDate === "string" &&
    typeof payload.endDate === "string" &&
    typeof payload.fullRefreshAt === "string" &&
    Array.isArray(payload.points);
};

const mergeByDate = <TPoint extends HistoryRangePoint>(
  existing: TPoint[],
  refreshed: TPoint[],
) => {
  const byDate = new Map(existing.map((point) => [point.date, point] as const));
  for (const point of refreshed) {
    if (point.date) byDate.set(point.date, point);
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
};

/**
 * Reuses a recent, stable history prefix and refreshes only an overlapping tail.
 * A full provider download is forced at least weekly to catch corrections and
 * corporate-action adjustments in older history.
 */
export const resolveHistoryRangeCache = async <TPoint extends HistoryRangePoint>({
  cached,
  startDate,
  endDate,
  now = Date.now(),
  fetchRange,
}: {
  cached?: HistoryRangeCacheEntry | null;
  startDate: string;
  endDate: string;
  now?: number;
  fetchRange: (rangeStart: string, rangeEnd: string) => Promise<TPoint[]>;
}): Promise<HistoryRangeCacheResolution<TPoint>> => {
  const cachedAt = cached ? Date.parse(cached.updatedAt) : Number.NaN;
  const cachedPayload = cached && isHistoryRangePayload<TPoint>(cached.payload)
    ? cached.payload
    : null;
  const cacheAgeMs = Number.isFinite(cachedAt)
    ? Math.max(0, now - cachedAt)
    : Number.POSITIVE_INFINITY;
  const fullRefreshAt = cachedPayload ? Date.parse(cachedPayload.fullRefreshAt) : Number.NaN;
  const fullRefreshAgeMs = Number.isFinite(fullRefreshAt)
    ? Math.max(0, now - fullRefreshAt)
    : Number.POSITIVE_INFINITY;

  if (
    cachedPayload?.startDate === startDate &&
    cachedPayload.endDate >= endDate &&
    cachedPayload.points.length === 0 &&
    cacheAgeMs <= EMPTY_HISTORY_CACHE_TTL_MS
  ) {
    return { payload: cachedPayload, cacheStatus: "hit" };
  }

  if (cachedPayload?.startDate === startDate && cachedPayload.points.length > 0) {
    const coverageEnd = cachedPayload.endDate >= endDate ? cachedPayload.endDate : endDate;

    // A failed full refresh is persisted with a recent updatedAt but retains
    // the old fullRefreshAt. Avoid retrying it for every request while still
    // allowing a missing date tail to be fetched.
    if (fullRefreshAgeMs > MAX_INCREMENTAL_REFRESH_AGE_MS && cacheAgeMs <= EMPTY_HISTORY_CACHE_TTL_MS) {
      if (cachedPayload.endDate >= endDate) {
        return { payload: cachedPayload, cacheStatus: "hit" };
      }

      const overlapStart = shiftDate(cachedPayload.endDate, -OVERLAP_DAYS);
      const tailStart = overlapStart < startDate ? startDate : overlapStart;
      const refreshedTail = await fetchRange(tailStart, endDate);
      return {
        payload: {
          ...cachedPayload,
          endDate,
          points: mergeByDate(cachedPayload.points, refreshedTail),
        },
        cacheStatus: "tail",
      };
    }

    if (fullRefreshAgeMs <= MAX_INCREMENTAL_REFRESH_AGE_MS) {
      if (cachedPayload.endDate >= endDate && cacheAgeMs <= 6 * 60 * 60 * 1_000) {
        return { payload: cachedPayload, cacheStatus: "hit" };
      }

      const overlapStart = shiftDate(cachedPayload.endDate, -OVERLAP_DAYS);
      const tailStart = overlapStart < startDate ? startDate : overlapStart;
      const refreshedTail = await fetchRange(tailStart, coverageEnd);
      return {
        payload: {
          ...cachedPayload,
          endDate: coverageEnd,
          points: mergeByDate(cachedPayload.points, refreshedTail),
        },
        cacheStatus: "tail",
      };
    }
  }

  const coverageEnd =
    cachedPayload?.startDate === startDate && cachedPayload.endDate > endDate
      ? cachedPayload.endDate
      : endDate;
  const points = await fetchRange(startDate, coverageEnd);
  if (
    points.length === 0 &&
    cachedPayload?.startDate === startDate &&
    cachedPayload.points.length > 0
  ) {
    return { payload: cachedPayload, cacheStatus: "stale" };
  }

  return {
    payload: {
      version: 1,
      startDate,
      endDate: coverageEnd,
      fullRefreshAt: new Date(now).toISOString(),
      points,
    },
    cacheStatus: "full",
  };
};

export const HISTORY_RANGE_INCREMENTAL_REFRESH_INTERVAL_MS = MAX_INCREMENTAL_REFRESH_AGE_MS;
