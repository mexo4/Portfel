/** RFC 5545 serialization for publicly announced GPW events. No user data. */
export const ICAL_CATEGORIES = ["reports", "dividends", "meetings"] as const;
export type IcalCategory = (typeof ICAL_CATEGORIES)[number];
export type IcalKind = "QUARTERLY_REPORT" | "HALF_YEAR_REPORT" | "ANNUAL_REPORT" |
  "UPCOMING_DIVIDEND" | "GENERAL_MEETING";

export type IcalSourceRow = {
  id: string;
  ticker: string;
  company_name: string;
  event_type: IcalKind;
  event_date: string;
  event_time: string | null;
  fiscal_period: string | null;
  fiscal_year: number | null;
  fiscal_year_label?: string | null;
  general_meeting_type: "ZWZ" | "NWZ" | null;
  dividend_per_share: number | string | null;
  dividend_currency: string | null;
  record_date: string | null;
  payment_date: string | null;
  status: string;
  active: boolean;
  updated_at: string;
  source_url: string;
  source_published_at: string | null;
};

export type IcalMilestone = {
  uid: string;
  date: string;
  summary: string;
  description: string;
  sourceUrl: string;
  category: IcalCategory;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  updatedAt: string;
};

export const parseIcalCategories = (value: string | null): IcalCategory[] | null => {
  if (value === null) return [...ICAL_CATEGORIES];
  if (value.length < 1 || value.length > 100) return null;
  const requested = value.split(",").map((part) => part.trim());
  if (requested.length === 0 || requested.some((part) => !ICAL_CATEGORIES.includes(part as IcalCategory))) return null;
  // Stable order avoids duplicate subscription URLs for identical category sets.
  return ICAL_CATEGORIES.filter((category) => requested.includes(category));
};

/** Empty list = whole GPW. Malformed or excessive ticker filters must never broaden the feed. */
export const parseIcalTickers = (value: string | null): string[] | null => {
  if (value === null) return [];
  if (value.length < 1 || value.length > 390) return null;
  const parts = value.split(",").map((item) => item.trim().toUpperCase());
  if (parts.some((ticker) => !/^[A-Z0-9]{1,12}$/.test(ticker))) return null;
  const unique = [...new Set(parts)].sort();
  return unique.length <= 30 ? unique : null;
};

export const ICAL_COLORS: Record<IcalCategory, { css: string; ical: string }> = {
  reports: { css: "#4169e1", ical: "royalblue" },
  dividends: { css: "#22a663", ical: "mediumseagreen" },
  meetings: { css: "#ed8a23", ical: "darkorange" },
};

export const getIcalSubscriptionUrl = (categories: readonly IcalCategory[], tickers: readonly string[] = []) => {
  const ordered = ICAL_CATEGORIES.filter((category) => categories.includes(category));
  if (ordered.length === 0) throw new Error("Wybierz kategorię kalendarza.");
  const normalized = tickers.length === 0 ? [] : parseIcalTickers(tickers.join(","));
  if (normalized === null || (tickers.length > 0 && normalized.length === 0)) {
    throw new Error("Niepoprawna lista spółek.");
  }
  return `https://mexo.com.pl/api/calendar/gpw.ics?categories=${ordered.join(",")}${normalized.length ? `&tickers=${normalized.join(",")}` : ""}`;
};

export const isValidIcalDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const icalTomorrow = (date: string) => {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export const icalDate = (date: string) => date.replace(/-/g, "");

export const escapeIcalText = (value: string) => value
  .replace(/\\/g, "\\\\")
  .replace(/\r\n|\r|\n/g, "\\n")
  .replace(/;/g, "\\;")
  .replace(/,/g, "\\,");

/** Fold at 75 OCTETS (not JS code units); continuation starts with one space. */
export const foldIcalLine = (value: string) => {
  const lines: string[] = [];
  const encoder = new TextEncoder();
  let line = "";
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += char;
    bytes += size;
  }
  lines.push(line);
  return lines.join("\r\n");
};

const safeSourceUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host) ||
      /^\[(?:::1|fc|fd|fe80)/.test(host)) return null;
    return url.href;
  } catch { return null; }
};

const status = (value: string): IcalMilestone["status"] =>
  value === "CANCELLED" ? "CANCELLED" : value === "PROPOSED" || value === "UNKNOWN" ? "TENTATIVE" : "CONFIRMED";

const getTimestamp = (value: string, fallback: string | null) => {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  if (fallback && !Number.isNaN(Date.parse(fallback))) return new Date(fallback).toISOString();
  return "2000-01-01T00:00:00.000Z";
};

const toAmountLabel = (value: string | number | null, currency: string | null) => {
  if (value === null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 4 }).format(amount)} ${currency || "PLN"}/akcję`;
};

/** Stable source-id + MILESTONE identifiers survive term changes. */
export const toIcalMilestones = (row: IcalSourceRow, from: string, to: string): IcalMilestone[] => {
  if (!row.id || !row.ticker.trim() || !row.company_name.trim()) return [];
  const url = safeSourceUrl(row.source_url);
  if (!url) return [];
  const category: IcalCategory = row.event_type === "GENERAL_MEETING" ? "meetings" :
    row.event_type === "UPCOMING_DIVIDEND" ? "dividends" : "reports";
  const updatedAt = getTimestamp(row.updated_at, row.source_published_at);
  const issuer = `${row.company_name} (${row.ticker})`;
  const mark = status(row.status);
  const common = [
    `Spółka: ${issuer}`,
    `Status Mexo: ${row.status}`,
    row.event_time ? `Godzina podana przez emitenta: ${row.event_time}` : null,
    "Dane informacyjne — potwierdź termin w oficjalnym źródle.",
    `Źródło: ${url}`,
  ].filter(Boolean).join("\n");
  const events: IcalMilestone[] = [];
  const add = (suffix: string, value: string | null, summary: string, description: string) => {
    if (!isValidIcalDate(value) || value < from || value > to) return;
    events.push({
      uid: `${row.id}:${suffix}@mexo.com.pl`, date: value, summary,
      description, sourceUrl: url, category, status: mark, updatedAt,
    });
  };
  if (category === "dividends") {
    const amount = toAmountLabel(row.dividend_per_share, row.dividend_currency);
    const meta = [common, amount ? `Kwota: ${amount}` : null,
      isValidIcalDate(row.record_date) ? `Dzień dywidendy: ${row.record_date}` : null,
      isValidIcalDate(row.payment_date) ? `Wypłata: ${row.payment_date}` : null,
    ].filter(Boolean).join("\n");
    // Two independent milestones: never invent the record date from event_date.
    add("record", row.record_date, `${issuer} — dzień dywidendy`, meta);
    add("payment", row.payment_date, `${issuer} — wypłata dywidendy`, meta);
    if (!isValidIcalDate(row.record_date) && !isValidIcalDate(row.payment_date)) {
      add("dividend-announcement", row.event_date, `${issuer} — termin dywidendowy (nieustalony rodzaj)`, meta);
    }
  } else if (category === "meetings") {
    const label = row.general_meeting_type === "NWZ" ? "Nadzwyczajne walne zgromadzenie" :
      row.general_meeting_type === "ZWZ" ? "Zwyczajne walne zgromadzenie" : "Walne zgromadzenie";
    add("meeting", row.event_date, `${issuer} — ${label}`, common);
  } else {
    const typeLabel = row.event_type === "ANNUAL_REPORT" ? "Raport roczny" :
      row.event_type === "HALF_YEAR_REPORT" ? "Raport półroczny" : "Raport kwartalny";
    const period = row.fiscal_period?.trim() || "";
    const fiscalYearLabel = row.fiscal_year_label?.trim() || (row.fiscal_year ? String(row.fiscal_year) : "");
    const year = fiscalYearLabel && !period.includes(fiscalYearLabel) ? ` ${fiscalYearLabel}` : "";
    add("report", row.event_date, `${issuer} — ${typeLabel}${period ? ` ${period}` : ""}${year}`, common);
  }
  return events;
};

const utcStamp = (timestamp: string) => new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export const serializeIcal = (
  events: readonly IcalMilestone[],
  categories: readonly IcalCategory[],
  tickers: readonly string[] = [],
  options?: { sourceUrl?: string; title?: string },
) => {
  const source = options?.sourceUrl ?? getIcalSubscriptionUrl(categories, tickers);
  const chosen = ICAL_CATEGORIES.filter((category) => categories.includes(category));
  const title = options?.title ?? `Mexo — GPW (${chosen.join(" + ")})${tickers.length ? ` — ${tickers.join(", ")}` : ""}`;
  const calendarColor = chosen.length === 1 ? ICAL_COLORS[chosen[0]!]!.ical : "slategray";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mexo//GPW Calendar//PL",
    "CALSCALE:GREGORIAN", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    `NAME:${escapeIcalText(title)}`, `X-WR-CALNAME:${escapeIcalText(title)}`,
    "X-WR-TIMEZONE:Europe/Warsaw", `COLOR:${calendarColor}`,
    ...(chosen.length === 1 ? [`X-APPLE-CALENDAR-COLOR:${ICAL_COLORS[chosen[0]!]!.css}`] : []),
    `SOURCE;VALUE=URI:${source}`,
  ];
  const seen = new Set<string>();
  for (const event of [...events].sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid))) {
    if (seen.has(event.uid) || !isValidIcalDate(event.date)) continue;
    seen.add(event.uid);
    const stamp = utcStamp(event.updatedAt);
    const sequence = Math.floor(Date.parse(event.updatedAt) / 1000);
    lines.push(
      "BEGIN:VEVENT", `UID:${escapeIcalText(event.uid)}`,
      `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${sequence}`,
      `DTSTART;VALUE=DATE:${icalDate(event.date)}`,
      `DTEND;VALUE=DATE:${icalDate(icalTomorrow(event.date))}`,
      `SUMMARY:${escapeIcalText(event.summary)}`,
      `DESCRIPTION:${escapeIcalText(event.description)}`,
      `URL:${event.sourceUrl}`, `CATEGORIES:${event.category.toUpperCase()}`,
      `COLOR:${ICAL_COLORS[event.category].ical}`,
      `STATUS:${event.status}`, "TRANSP:TRANSPARENT", "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcalLine).join("\r\n") + "\r\n";
};
