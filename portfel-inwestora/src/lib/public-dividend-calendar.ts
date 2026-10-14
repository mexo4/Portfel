/**
 * Public dividend-calendar helpers. This module does not access user accounts,
 * broker data, external services or React; it is safe to test independently.
 */
export const DIVIDEND_VIEWS = ["upcoming", "history", "year"] as const;
export const DIVIDEND_STATUSES = ["all", "confirmed", "proposed", "other"] as const;
export const DIVIDEND_SORTS = ["date", "amount", "company"] as const;

export type DividendView = (typeof DIVIDEND_VIEWS)[number];
export type DividendStatusFilter = (typeof DIVIDEND_STATUSES)[number];
export type DividendSort = (typeof DIVIDEND_SORTS)[number];
export type PublicDividendStatus = "PROPOSED" | "CONFIRMED" | "CHANGED" | "UNKNOWN";
export type DividendDateKind = "record" | "payment" | "event";

export type PublicDividendRow = {
  id: string;
  ticker: string;
  company_name: string;
  event_date: string;
  ex_dividend_date: string | null;
  record_date: string | null;
  payment_date: string | null;
  dividend_per_share: number | string | null;
  dividend_currency: string | null;
  dividend_total_per_share: number | string | null;
  dividend_advance_per_share: number | string | null;
  dividend_installment: number | null;
  fiscal_year: number | null;
  status: string;
  updated_at: string;
  source_url: string;
  source_published_at: string | null;
};

export type PublicDividend = {
  id: string;
  ticker: string;
  companyName: string;
  displayDate: string;
  displayDateKind: DividendDateKind;
  recordDate?: string;
  exDividendDate?: string;
  paymentDate?: string;
  amount?: number;
  currency: string;
  totalPerShare?: number;
  advancePerShare?: number;
  installment?: number;
  fiscalYear?: number;
  status: PublicDividendStatus;
  sourceUrl: string;
  sourcePublishedAt?: string;
  updatedAt: string;
};

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

export const isIsoCalendarDate = (input: unknown): input is string => {
  if (typeof input !== "string" || !ISO_DATE.test(input)) return false;
  const date = new Date(`${input}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === input;
};

export const getWarsawDividendToday = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);

export const parseDividendView = (value: unknown): DividendView =>
  typeof value === "string" && DIVIDEND_VIEWS.some((item) => item === value)
    ? value as DividendView : "upcoming";

export const parseDividendStatus = (value: unknown): DividendStatusFilter =>
  typeof value === "string" && DIVIDEND_STATUSES.some((item) => item === value)
    ? value as DividendStatusFilter : "all";

export const parseDividendSort = (value: unknown): DividendSort =>
  typeof value === "string" && DIVIDEND_SORTS.some((item) => item === value)
    ? value as DividendSort : "date";

export const normalizeDividendCompanySearch = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 70) : "";

const changeDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export const getDividendYear = (value: unknown, today = getWarsawDividendToday()) => {
  const currentYear = Number(today.slice(0, 4));
  const year = typeof value === "string" && /^20\d{2}$/.test(value) ? Number(value) : currentYear;
  return Math.min(currentYear + 2, Math.max(currentYear - 10, year));
};

export const getDividendWindow = (
  view: DividendView,
  year: number,
  today = getWarsawDividendToday()
) => {
  if (view === "year") {
    return { from: `${year}-01-01`, to: `${year}-12-31`, title: `Dywidendy w ${year} roku` };
  }
  if (view === "history") {
    return { from: changeDays(today, -365), to: changeDays(today, -1), title: "Poprzednie 12 miesięcy" };
  }
  const end = new Date(`${today}T12:00:00.000Z`);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { from: today, to: end.toISOString().slice(0, 10), title: "Nadchodzące 12 miesięcy" };
};

/** Use external URLs only for clickable source citations, never for server-side fetching. */
export const safeDividendSourceUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !hostname.includes(".")) return null;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
        hostname.endsWith(".internal") || hostname.endsWith(".test") ||
        /^\[(?:::1|fe80:|fc|fd)/i.test(hostname) ||
        /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
};

const parseAmount = (value: unknown): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 && numeric < 1_000_000_000 ? numeric : undefined;
};

const inRange = (value: string, from: string, to: string) => value >= from && value <= to;

/**
 * Decide which reported date makes a dividend appear in the chosen window.
 * A past record date with a future payment is displayed as a payment; it must
 * not disappear from the upcoming list or be mislabelled a future record date.
 */
export const getDividendDisplayDate = (
  row: Pick<PublicDividendRow, "record_date" | "payment_date" | "event_date" | "ex_dividend_date">,
  from: string,
  to: string,
  view: DividendView
): { date: string; kind: DividendDateKind } | null => {
  const dates: { date: string; kind: DividendDateKind }[] = [];
  if (isIsoCalendarDate(row.record_date)) dates.push({ date: row.record_date, kind: "record" });
  if (isIsoCalendarDate(row.payment_date) && row.payment_date !== row.record_date) {
    dates.push({ date: row.payment_date, kind: "payment" });
  }
  // event_date is the original parser's resolved date. Only use it as a
  // fallback if we have no explicit record/payment dates for the selected range.
  const valid = dates.filter((item) => inRange(item.date, from, to));
  if (valid.length > 0) {
    valid.sort((a, b) => view === "history"
      ? b.date.localeCompare(a.date)
      : a.date.localeCompare(b.date));
    return valid[0]!;
  }
  if (dates.length === 0 && isIsoCalendarDate(row.event_date) && inRange(row.event_date, from, to)) {
    return { date: row.event_date, kind: "event" };
  }
  if (dates.length === 0 && isIsoCalendarDate(row.ex_dividend_date) && inRange(row.ex_dividend_date, from, to)) {
    return { date: row.ex_dividend_date, kind: "event" };
  }
  return null;
};

export const toPublicDividend = (
  row: PublicDividendRow,
  from: string,
  to: string,
  view: DividendView
): PublicDividend | null => {
  const sourceUrl = safeDividendSourceUrl(row.source_url);
  const date = getDividendDisplayDate(row, from, to, view);
  if (!sourceUrl || !date || !row.ticker.trim() || !row.company_name.trim() || row.status === "CANCELLED") return null;
  const status: PublicDividendStatus = row.status === "PROPOSED" || row.status === "CONFIRMED" || row.status === "CHANGED"
    ? row.status : "UNKNOWN";
  return {
    id: row.id,
    ticker: row.ticker,
    companyName: row.company_name,
    displayDate: date.date,
    displayDateKind: date.kind,
    recordDate: isIsoCalendarDate(row.record_date) ? row.record_date : undefined,
    exDividendDate: isIsoCalendarDate(row.ex_dividend_date) ? row.ex_dividend_date : undefined,
    paymentDate: isIsoCalendarDate(row.payment_date) ? row.payment_date : undefined,
    amount: parseAmount(row.dividend_per_share),
    totalPerShare: parseAmount(row.dividend_total_per_share),
    advancePerShare: parseAmount(row.dividend_advance_per_share),
    currency: row.dividend_currency?.trim().toUpperCase() || "—",
    installment: row.dividend_installment && row.dividend_installment > 0 ? row.dividend_installment : undefined,
    fiscalYear: row.fiscal_year ?? undefined,
    status,
    sourceUrl,
    sourcePublishedAt: row.source_published_at ?? undefined,
    updatedAt: row.updated_at,
  };
};

export const matchesDividendStatus = (item: PublicDividend, status: DividendStatusFilter) =>
  status === "all" ||
  (status === "confirmed" && item.status === "CONFIRMED") ||
  (status === "proposed" && item.status === "PROPOSED") ||
  (status === "other" && (item.status === "UNKNOWN" || item.status === "CHANGED"));

export const sortPublicDividends = (items: PublicDividend[], sort: DividendSort, view: DividendView) =>
  [...items].sort((a, b) => {
    if (sort === "amount") {
      const left = a.amount ?? Number.NEGATIVE_INFINITY;
      const right = b.amount ?? Number.NEGATIVE_INFINITY;
      if (right !== left) return right - left;
    }
    if (sort === "company") {
      const cmp = a.companyName.localeCompare(b.companyName, "pl");
      if (cmp) return cmp;
    }
    const byDate = a.displayDate.localeCompare(b.displayDate);
    if (byDate) return view === "history" ? -byDate : byDate;
    return a.companyName.localeCompare(b.companyName, "pl") || a.id.localeCompare(b.id);
  });

export const getDividendStatusLabel = (status: PublicDividendStatus) => {
  if (status === "CONFIRMED") return "Potwierdzona";
  if (status === "PROPOSED") return "Propozycja";
  if (status === "CHANGED") return "Zmieniona";
  return "Nieustalony status";
};

export const getDividendDateKindLabel = (kind: DividendDateKind) => {
  if (kind === "record") return "Dzień dywidendy";
  if (kind === "payment") return "Termin wypłaty";
  return "Termin zdarzenia";
};

export const getDividendHref = ({
  view = "upcoming", status = "all", sort = "date", year, company = "",
}: {
  view?: DividendView;
  status?: DividendStatusFilter;
  sort?: DividendSort;
  year?: number;
  company?: string;
}) => {
  const params = new URLSearchParams();
  if (view !== "upcoming") params.set("widok", view);
  if (view === "year" && year !== undefined) params.set("rok", String(year));
  if (status !== "all") params.set("status", status);
  if (sort !== "date") params.set("sortowanie", sort);
  if (company) params.set("spolka", normalizeDividendCompanySearch(company));
  const query = params.toString();
  return query ? `/kalendarz-dywidend?${query}` : "/kalendarz-dywidend";
};
