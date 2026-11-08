export type FxRateQuality = "confirmed" | "historically-carried" | "stale" | "fallback" | "unavailable";

export const MAX_HISTORICAL_FX_CARRY_DAYS = 7;
const DAY_MS = 86_400_000;

export const calendarDaysBetween = (fromDate: string, toDate: string) => {
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.abs(to - from) / DAY_MS);
};

export const classifyFxRateQuality = (
  input: { rate?: number | null; asOf?: string | null; targetDate?: string; source?: "eodhd" | "nbp" | "fallback" | null },
  maxCarryDays = MAX_HISTORICAL_FX_CARRY_DAYS
): FxRateQuality => {
  if (typeof input.rate !== "number" || !Number.isFinite(input.rate) || input.rate <= 0) return "unavailable";
  if (input.source === "fallback") return "fallback";
  if (!input.asOf) return "stale";
  const targetDate = input.targetDate ?? new Date().toISOString().slice(0, 10);
  if (input.asOf.slice(0, 10) > targetDate) return "stale";
  const ageDays = calendarDaysBetween(input.asOf.slice(0, 10), targetDate);
  if (!Number.isFinite(ageDays) || ageDays > maxCarryDays) return "stale";
  if (ageDays === 0) return "confirmed";
  return "historically-carried";
};

export const shouldTrustHistoricalFxRate = (rate: number | undefined, asOf: string | undefined, targetDate: string) =>
  typeof rate === "number" && Number.isFinite(rate) && rate > 0 && Boolean(asOf) &&
  asOf!.slice(0, 10) <= targetDate &&
  calendarDaysBetween(asOf!, targetDate) <= MAX_HISTORICAL_FX_CARRY_DAYS;

export const getVerifiedHistoricalFxRate = (
  currency: string,
  snapshot: {
    rates: Record<string, number | undefined>;
    quality?: Partial<Record<string, { status?: FxRateQuality; source?: string | null }>>;
  }
) => {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (normalizedCurrency === "PLN") return 1;

  const rate = snapshot.rates[normalizedCurrency];
  const quality = snapshot.quality?.[normalizedCurrency];
  if (
    typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 ||
    (quality?.status !== "confirmed" && quality?.status !== "historically-carried") ||
    (quality.source !== "nbp" && quality.source !== "eodhd")
  ) {
    return undefined;
  }

  return rate;
};
