import type { ParsedCorporateEvent } from "@/lib/corporate-events";

export type StoredDividendProjection = {
  id: string;
  event_identity: string;
  event_date: string;
  record_date: string | null;
  payment_date: string | null;
  dividend_installment: number | null;
  dividend_per_share: number | null;
  status: string;
  source_published_at: string | null;
  source_urls: string[];
};

export type DividendReprojectionPlan = {
  deactivateIds: string[];
  retainedIds: string[];
  ambiguousIds: string[];
};

/**
 * A source may be reparsed after a parser fix. Only its exclusively-owned
 * projections may be withdrawn. An empty parse is evidence of withdrawal
 * solely for an explicitly identified non-binding draft, never for a failed
 * download or an arbitrary report with no recognized event.
 */
export const planDividendSourceReprojection = (
  existing: StoredDividendProjection[],
  parsed: ParsedCorporateEvent[],
  sourceUrl: string,
  parseComplete: boolean,
  nonBindingDraft: boolean
): DividendReprojectionPlan => {
  const dividends = parsed.filter((event) => event.eventType === "UPCOMING_DIVIDEND");
  const expected = new Set(dividends.map((event) => event.eventIdentity));
  const dates = new Set(dividends.map((event) => event.eventDate));
  const result: DividendReprojectionPlan = { deactivateIds: [], retainedIds: [], ambiguousIds: [] };
  for (const old of existing) {
    if (expected.has(old.event_identity)) {
      result.retainedIds.push(old.id);
    } else if (!parseComplete || old.source_urls.length !== 1 || old.source_urls[0] !== sourceUrl) {
      result.ambiguousIds.push(old.id);
    } else if (nonBindingDraft || (dividends.length > 0 && dates.has(old.event_date))) {
      result.deactivateIds.push(old.id);
    } else {
      result.ambiguousIds.push(old.id);
    }
  }
  return result;
};

/** A final resolution explicitly stating one or several installments can
 * supersede a stale, different installment shape for the SAME record date.
 * This does not merge unrelated distributions merely by ticker or year. */
export const planDividendFinalResolution = (
  existing: StoredDividendProjection[],
  parsed: ParsedCorporateEvent[],
  publishedAt: string | null
): DividendReprojectionPlan => {
  const confirmed = parsed.filter((event) => event.eventType === "UPCOMING_DIVIDEND" &&
    event.dividendStatus === "CONFIRMED" && event.recordDate && !event.isCancellation);
  const dates = new Set(confirmed.map((event) => event.recordDate));
  const result: DividendReprojectionPlan = { deactivateIds: [], retainedIds: [], ambiguousIds: [] };
  if (confirmed.length === 0 || dates.size !== 1 || confirmed.length !== parsed.filter((event) =>
    event.eventType === "UPCOMING_DIVIDEND").length) {
    result.ambiguousIds.push(...existing.map((event) => event.id));
    return result;
  }
  const installments = new Set(confirmed.map((event) => event.dividendInstallment ?? null));
  const total = confirmed[0]?.dividendTotalPerShare ?? confirmed.reduce((sum, event) => sum + (event.dividendPerShare ?? 0), 0);
  const distribution = confirmed[0]?.eventIdentity?.replace(/:[^:]+$/, "");
  for (const old of existing) {
    const newerPublication = publishedAt && old.source_published_at &&
      Date.parse(old.source_published_at) > Date.parse(publishedAt);
    const samePublicationDay = newerPublication &&
      old.source_published_at!.slice(0, 10) === publishedAt!.slice(0, 10);
    const amountIsReused = old.dividend_per_share !== null &&
      (Math.abs(old.dividend_per_share - total) < 0.005 || confirmed.some((event) =>
        event.dividendPerShare !== undefined && Math.abs(old.dividend_per_share! - event.dividendPerShare) < 0.005));
    if (old.record_date !== confirmed[0]!.recordDate || !distribution ||
      !old.event_identity.startsWith(`${distribution}:`)) {
      result.retainedIds.push(old.id);
    } else if (installments.has(old.dividend_installment) ||
      (newerPublication && !(samePublicationDay && amountIsReused))) {
      result.retainedIds.push(old.id);
    } else {
      result.deactivateIds.push(old.id);
    }
  }
  return result;
};

/** An older proposal must not overwrite a later resolution during a
 * newest-first historical backfill. A newer row is considered relevant only
 * when its explicitly known record date matches every incoming event. */
export const isDividendReportSuperseded = (
  existing: StoredDividendProjection[],
  parsed: ParsedCorporateEvent[],
  publishedAt: string | null
) => {
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) return false;
  const dividends = parsed.filter((event) => event.eventType === "UPCOMING_DIVIDEND");
  return dividends.length > 0 && dividends.every((event) => event.recordDate && existing.some((old) =>
    old.record_date === event.recordDate && old.event_identity === event.eventIdentity &&
    old.status === "CONFIRMED" &&
    old.source_published_at && Date.parse(old.source_published_at) > Date.parse(publishedAt)));
};
