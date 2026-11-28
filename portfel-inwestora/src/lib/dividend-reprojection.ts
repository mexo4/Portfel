import { isDividendAdvanceIdentity, type ParsedCorporateEvent, type getDividendAmendmentEvidence } from "@/lib/corporate-events";

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
  /** Rows other sources still support, which this source no longer does: only its link goes. */
  detachIds?: string[];
};

/**
 * Whether a stored row is the distribution a parsed event describes. Advances used to be stored under
 * the year's single identity ("dividend:2026:single"); such a row is still the same advance when its
 * dividend day or payment day is the advance's.
 */
export const isSameDividendDistribution = (old: StoredDividendProjection, event: ParsedCorporateEvent) =>
  old.event_identity === event.eventIdentity ||
  (isDividendAdvanceIdentity(event.eventIdentity) && /^dividend:[^:]+:single$/.test(old.event_identity) &&
    ((old.record_date !== null && old.record_date === event.recordDate) ||
      (old.payment_date !== null && old.payment_date === event.paymentDate)));

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
  const dates = new Set(dividends.map((event) => event.eventDate));
  const result: DividendReprojectionPlan = { deactivateIds: [], retainedIds: [], ambiguousIds: [], detachIds: [] };
  for (const old of existing) {
    const sharesADay = dividends.some((event) =>
      (old.record_date !== null && old.record_date === event.recordDate) ||
      (old.payment_date !== null && old.payment_date === event.paymentDate));
    if (dividends.some((event) => isSameDividendDistribution(old, event))) {
      result.retainedIds.push(old.id);
    } else if (parseComplete && dividends.length > 0 && old.source_urls.length > 1 &&
      old.source_urls.includes(sourceUrl) && !sharesADay && !dates.has(old.event_date)) {
      // Another distribution took this source by mistake (a second advance read as the first one).
      // The row stands on its other sources; this document describes different days.
      result.detachIds!.push(old.id);
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

/** A shareholder's proposed amendment is not itself a resolution. When its
 * PDF is unavailable, retire an old-date projection only if a separate,
 * later official report confirms the proposed new payment date and amount.
 * Otherwise leave the row for review rather than guessing the vote's result. */
export const planDividendRejectedAmendment = (
  existing: StoredDividendProjection[],
  evidence: ReturnType<typeof getDividendAmendmentEvidence>,
  sourceUrl: string,
  laterOfficialEvents: ParsedCorporateEvent[]
): DividendReprojectionPlan => {
  const result: DividendReprojectionPlan = { deactivateIds: [], retainedIds: [], ambiguousIds: [] };
  const oldDate = evidence.previousPaymentDate;
  const confirmedDate = evidence.proposedPaymentDate;
  const confirmedAmount = evidence.proposedAmount;
  const corroborated = Boolean(oldDate && confirmedDate && confirmedAmount !== undefined &&
    laterOfficialEvents.some((event) => event.eventType === "UPCOMING_DIVIDEND" &&
      event.dividendStatus === "CONFIRMED" && event.paymentDate === confirmedDate &&
      event.dividendPerShare !== undefined && Math.abs(event.dividendPerShare - confirmedAmount!) < 0.005));
  for (const old of existing) {
    if (corroborated && old.payment_date === oldDate && old.record_date === null &&
      old.source_urls.length === 1 && old.source_urls[0] === sourceUrl) {
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
    // Older proposals often name the profit year, while a later resolution
    // without that phrase falls back to the record year. The prior-year,
    // single-payment proposal is still the same distribution when the record
    // date matches and the final resolution explicitly splits it into rates.
    const proposalYear = /^dividend:(20\d{2}):single$/.exec(old.event_identity)?.[1];
    const replacedPriorYearProposal = confirmed.length > 1 && proposalYear &&
      Number(proposalYear) === Number(confirmed[0]!.recordDate!.slice(0, 4)) - 1 &&
      old.dividend_installment === null && old.payment_date === null &&
      old.source_urls.length === 1 && /(?:wniosek|propozycj)/iu.test(old.source_urls[0]!) &&
      old.source_published_at && publishedAt &&
      Date.parse(old.source_published_at) < Date.parse(publishedAt);
    if (old.record_date === confirmed[0]!.recordDate && replacedPriorYearProposal) {
      result.deactivateIds.push(old.id);
      continue;
    }
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
    old.record_date === event.recordDate && old.status === "CONFIRMED" &&
    (old.event_identity === event.eventIdentity ||
      (event.dividendStatus === "PROPOSED" && old.dividend_installment !== null)) &&
    old.source_published_at && Date.parse(old.source_published_at) > Date.parse(publishedAt)));
};
