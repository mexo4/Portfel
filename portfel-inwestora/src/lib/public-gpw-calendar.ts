/** Pure, server/client-neutral helpers for the public GPW events calendar. */
import { getStatutoryMeetingRegistrationDate } from "@/lib/corporate-events";
export const GPW_CALENDAR_CATEGORIES = ["all", "reports", "meetings", "dividends"] as const;
export type GpwCalendarCategory = (typeof GPW_CALENDAR_CATEGORIES)[number];

export type PublicGpwEventKind =
  | "QUARTERLY_REPORT"
  | "HALF_YEAR_REPORT"
  | "ANNUAL_REPORT"
  | "GENERAL_MEETING"
  | "UPCOMING_DIVIDEND"
  | "DIVIDEND_PAYMENT";

export type PublicGpwCalendarEvent = {
  id: string;
  ticker: string;
  companyName: string;
  date: string;
  time?: string;
  kind: PublicGpwEventKind;
  generalMeetingType?: "ZWZ" | "NWZ";
  fiscalPeriod?: string;
  fiscalYear?: number;
  fiscalYearLabel?: string;
  registrationDate?: string;
  dividendPerShare?: number;
  dividendCurrency?: string;
  recordDate?: string;
  paymentDate?: string;
  status: "PROPOSED" | "CONFIRMED" | "CHANGED" | "UNKNOWN";
  sourceUrl: string;
  sourcePublishedAt?: string;
};

export const getWarsawCalendarMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Europe/Warsaw",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
};

export const getCalendarMonth = (input: string | undefined, current = getWarsawCalendarMonth()) => {
  const validCurrent = /^\d{4}-(0[1-9]|1[0-2])$/.test(current) ? current : "2026-01";
  const validInput = typeof input === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(input)
    ? input
    : validCurrent;
  const currentYear = Number(validCurrent.slice(0, 4));
  const year = Number(validInput.slice(0, 4));
  // Prevent arbitrary SQL scans of extremely distant months via public URLs.
  const month = year < currentYear - 5 || year > currentYear + 2
    ? validCurrent
    : validInput;
  const [displayYear, displayMonth] = month.split("-").map(Number);
  const first = new Date(Date.UTC(displayYear!, displayMonth! - 1, 1));
  const last = new Date(Date.UTC(displayYear!, displayMonth!, 0));
  const prev = new Date(Date.UTC(displayYear!, displayMonth! - 2, 1));
  const next = new Date(Date.UTC(displayYear!, displayMonth!, 1));
  return {
    key: month,
    start: `${month}-01`,
    end: `${month}-${String(last.getUTCDate()).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "long", timeZone: "UTC" }).format(first),
    prevKey: prev.toISOString().slice(0, 7),
    nextKey: next.toISOString().slice(0, 7),
    todayKey: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
  };
};

export const parseCalendarCategory = (value: unknown): GpwCalendarCategory =>
  typeof value === "string" && GPW_CALENDAR_CATEGORIES.some((category) => category === value)
    ? value as GpwCalendarCategory
    : "all";

export const normalizeCompanySearch = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 64) : "";

export const getGpwEventCategory = (kind: PublicGpwEventKind): Exclude<GpwCalendarCategory, "all"> => {
  if (kind === "GENERAL_MEETING") return "meetings";
  if (kind === "UPCOMING_DIVIDEND" || kind === "DIVIDEND_PAYMENT") return "dividends";
  return "reports";
};

export const getGpwEventLabel = (event: PublicGpwCalendarEvent) => {
  if (event.kind === "GENERAL_MEETING") {
    if (event.generalMeetingType === "ZWZ") return "Zwyczajne walne zgromadzenie";
    if (event.generalMeetingType === "NWZ") return "Nadzwyczajne walne zgromadzenie";
    return "Walne zgromadzenie";
  }
  if (event.kind === "DIVIDEND_PAYMENT") return "Wypłata dywidendy";
  if (event.kind === "UPCOMING_DIVIDEND") {
    if (event.recordDate === event.date) return "Dzień dywidendy";
    return "Wydarzenie dywidendowe";
  }
  const period = [event.fiscalPeriod, event.fiscalYearLabel ?? event.fiscalYear].filter(Boolean).join(" ");
  if (event.kind === "ANNUAL_REPORT") return `Raport roczny${period ? ` ${period}` : ""}`;
  if (event.kind === "HALF_YEAR_REPORT") return `Raport półroczny${period ? ` ${period}` : ""}`;
  return `Raport kwartalny${period ? ` ${period}` : ""}`;
};

export const getGpwEventStatusLabel = (status: PublicGpwCalendarEvent["status"]) => {
  if (status === "PROPOSED") return "Propozycja";
  if (status === "CHANGED") return "Termin zmieniony";
  if (status === "CONFIRMED") return "Potwierdzone";
  return "Status nieustalony";
};

/** Generate an ISO-date month grid starting on Monday; empty cells never claim data. */
export const buildGpwCalendarGrid = (
  month: Pick<ReturnType<typeof getCalendarMonth>, "start" | "end">,
  events: PublicGpwCalendarEvent[]
) => {
  const first = new Date(`${month.start}T12:00:00Z`);
  const end = new Date(`${month.end}T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = end.getUTCDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const byDate = new Map<string, PublicGpwCalendarEvent[]>();
  for (const event of events) {
    const matching = byDate.get(event.date) ?? [];
    matching.push(event);
    byDate.set(event.date, matching);
  }
  return Array.from({ length: cells }, (_, index) => {
    const d = new Date(first);
    d.setUTCDate(index - offset + 1);
    const date = d.toISOString().slice(0, 10);
    return {
      date,
      day: d.getUTCDate(),
      inMonth: index >= offset && index < offset + daysInMonth,
      events: byDate.get(date) ?? [],
    };
  });
};

export const groupGpwEventsByDate = (events: PublicGpwCalendarEvent[]) => {
  const groups = new Map<string, PublicGpwCalendarEvent[]>();
  for (const event of events) {
    const previous = groups.get(event.date) ?? [];
    groups.set(event.date, [...previous, event]);
  }
  return Array.from(groups, ([date, items]) => ({ date, events: items })).sort((a, b) => a.date.localeCompare(b.date));
};

export const getGpwCalendarHref = (month: string, category: GpwCalendarCategory, company: string) => {
  const query = new URLSearchParams({ miesiac: month });
  if (category !== "all") query.set("typ", category);
  if (company) query.set("spolka", company);
  return `/kalendarz-gpw?${query.toString()}`;
};

/** Narrow database DTO for issuer-only data, without any user or portfolio fields. */
export type PublicGpwStoredEventRow = {
  id: string;
  ticker: string;
  company_name: string;
  event_type: Exclude<PublicGpwEventKind, "DIVIDEND_PAYMENT">;
  event_date: string;
  event_time: string | null;
  fiscal_period: string | null;
  fiscal_year: number | null;
  fiscal_year_label?: string | null;
  general_meeting_type: "ZWZ" | "NWZ" | null;
  registration_date: string | null;
  dividend_per_share: number | string | null;
  dividend_currency: string | null;
  record_date: string | null;
  payment_date: string | null;
  status: PublicGpwCalendarEvent["status"] | "CANCELLED";
  updated_at: string;
  source_url: string;
  source_published_at: string | null;
};

/** Never emit untraceable, cancelled or suspiciously linked content publicly. */
export const getSafeGpwSourceUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
    if (url.username || url.password || url.hostname === "localhost" ||
      /^(?:127|10|192\.168|169\.254)\./.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
};

export const expandGpwStoredCalendarEvent = (
  row: PublicGpwStoredEventRow,
  from: string,
  to: string
): PublicGpwCalendarEvent[] => {
  const sourceUrl = getSafeGpwSourceUrl(row.source_url);
  if (!sourceUrl || row.status === "CANCELLED") return [];
  const numericDividend = Number(row.dividend_per_share);
  const dividendPerShare = row.dividend_per_share !== null &&
    Number.isFinite(numericDividend) && numericDividend > 0 ? numericDividend : undefined;
  const base = {
    ticker: row.ticker,
    companyName: row.company_name,
    time: row.event_time ?? undefined,
    generalMeetingType: row.general_meeting_type ?? undefined,
    fiscalPeriod: row.fiscal_period ?? undefined,
    fiscalYear: row.fiscal_year ?? undefined,
    fiscalYearLabel: row.fiscal_year_label ?? undefined,
    registrationDate: row.event_type === "GENERAL_MEETING"
      ? row.registration_date ?? getStatutoryMeetingRegistrationDate(row.event_date)
      : undefined,
    dividendPerShare,
    dividendCurrency: row.dividend_currency ?? undefined,
    recordDate: row.record_date ?? undefined,
    paymentDate: row.payment_date ?? undefined,
    status: row.status === "PROPOSED" || row.status === "CONFIRMED" || row.status === "CHANGED"
      ? row.status
      : "UNKNOWN" as const,
    sourceUrl,
    sourcePublishedAt: row.source_published_at ?? undefined,
  };
  const results: PublicGpwCalendarEvent[] = [];
  if (row.event_date >= from && row.event_date <= to) {
    const kind = row.event_type === "UPCOMING_DIVIDEND" &&
      row.payment_date === row.event_date && row.record_date !== row.event_date
      ? "DIVIDEND_PAYMENT" : row.event_type;
    results.push({ ...base, id: row.id, kind, date: row.event_date });
  }
  if (
    row.event_type === "UPCOMING_DIVIDEND" &&
    row.payment_date && row.payment_date !== row.event_date &&
    row.payment_date >= from && row.payment_date <= to
  ) {
    results.push({
      ...base,
      id: `${row.id}:payment`,
      kind: "DIVIDEND_PAYMENT",
      date: row.payment_date,
      time: undefined,
    });
  }
  return results;
};
