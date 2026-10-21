"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDividendCalendarDisplayStatus,
  type CorporateEvent,
  type DividendCalendarResponse,
  type DividendCalendarScope,
} from "@/lib/corporate-events";
import { fetchDividendCalendar } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

type DividendSort = "record-asc" | "record-desc" | "payment-asc" | "payment-desc";

const getWarsawDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const formatSyncTime = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const getStatusLabel = (event: CorporateEvent, today: string) => {
  switch (getDividendCalendarDisplayStatus(event, today)) {
    case "PROPOSED": return "Zaproponowana";
    case "CONFIRMED": return "Zatwierdzona";
    case "AWAITING_PAYMENT": return "Oczekuje na wypłatę";
    case "PAYMENT_DATE_PASSED": return "Termin wypłaty minął";
    default: return "Status niepotwierdzony";
  }
};

const getStatusClass = (event: CorporateEvent, today: string) =>
  `dividend-calendar-status is-${getDividendCalendarDisplayStatus(event, today).toLocaleLowerCase()}`;

const getSortValue = (event: CorporateEvent, sort: DividendSort) => {
  const value = sort.startsWith("record")
    ? event.recordDate ?? event.exDividendDate
    : event.paymentDate;
  return value ?? "9999-12-31";
};

const isWithinFilter = (event: CorporateEvent, from: string, to: string) => {
  const dates = [event.recordDate, event.paymentDate].filter((value): value is string => Boolean(value));
  if (!from && !to) return true;
  return dates.some((date) => (!from || date >= from) && (!to || date <= to));
};

const DividendSources = ({ event }: { event: CorporateEvent }) => {
  const sources = Array.from(new Map(
    [event.source, ...(event.sources ?? [])]
      .filter((source): source is NonNullable<CorporateEvent["source"]> => Boolean(source?.sourceUrl))
      .map((source) => [source.sourceUrl, source])
  ).values());
  if (!sources.length) return null;
  const [primary, ...additional] = sources;
  return (
    <div className="dividend-calendar-sources">
      <a className="corporate-event-source" href={primary!.sourceUrl} target="_blank" rel="noreferrer">
        Źródło
      </a>
      {additional.length ? (
        <details>
          <summary>Pozostałe źródła ({additional.length})</summary>
          <ul>
            {additional.map((source) => (
              <li key={source.sourceUrl}>
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                  {source.sourceTitle || "Oficjalny komunikat"}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
};

export default function DividendCalendarPanel() {
  const [data, setData] = useState<DividendCalendarResponse | null>(null);
  const [scope, setScope] = useState<DividendCalendarScope>("all");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<DividendSort>("record-asc");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const today = getWarsawDate();

  useEffect(() => {
    const controller = new AbortController();
    void fetchDividendCalendar({ scope, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [scope]);

  useEffect(() => {
    if (!data?.sourceState.isRefreshing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetchDividendCalendar({ scope, signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(response);
        setHasError(false);
        if (response.sourceState.isRefreshing) timer = setTimeout(() => void poll(), 8_000);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setData((current) => current ? {
          ...current,
          sourceState: { ...current.sourceState, status: "TEMPORARILY_UNAVAILABLE", isRefreshing: false, isStale: true },
        } : current);
      }
    };
    timer = setTimeout(() => void poll(), 8_000);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [data?.sourceState.isRefreshing, scope]);

  const events = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pl-PL");
    const descending = sort.endsWith("desc");
    return (data?.events ?? [])
      .filter((event) => event.eventType === "UPCOMING_DIVIDEND" && event.active && event.status !== "CANCELLED")
      .filter((event) => !normalizedQuery ||
        event.companyName.toLocaleLowerCase("pl-PL").includes(normalizedQuery) ||
        event.ticker.toLocaleLowerCase("pl-PL").includes(normalizedQuery))
      .filter((event) => isWithinFilter(event, dateFrom, dateTo))
      .sort((left, right) => {
        const result = getSortValue(left, sort).localeCompare(getSortValue(right, sort));
        return (descending ? -result : result) || left.companyName.localeCompare(right.companyName, "pl");
      });
  }, [data?.events, dateFrom, dateTo, query, sort]);

  return (
    <section className="panel dividend-calendar-panel" aria-busy={isLoading}>
      <div className="dividend-calendar-head">
        <div>
          <p className="eyebrow">Kalendarz GPW</p>
          <h2 className="section-title">Kalendarz dywidend</h2>
          <p className="section-copy">Oficjalne propozycje i uchwały emitentów z rynku głównego GPW.</p>
        </div>
        <span className="tag">12 miesięcy</span>
      </div>

      <div className="corporate-events-scope" role="group" aria-label="Zakres kalendarza dywidend">
        {([[
          "all", "Wszystkie",
        ], ["watchlist", "Obserwowane"], ["portfolio", "W portfelu"]] as const).map(([value, label]) => (
          <button
            className={scope === value ? "is-active" : undefined}
            key={value}
            type="button"
            aria-pressed={scope === value}
            onClick={() => {
              if (value === scope) return;
              setIsLoading(true);
              setHasError(false);
              setScope(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="dividend-calendar-filters">
        <label className="dividend-calendar-search">
          <span>Spółka lub ticker</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="np. KPL, Kino Polska" />
        </label>
        <label>
          <span>Od</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>Do</span>
          <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          <span>Sortowanie</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as DividendSort)}>
            <option value="record-asc">Dzień dywidendy · najbliższe</option>
            <option value="record-desc">Dzień dywidendy · najdalsze</option>
            <option value="payment-asc">Wypłata · najbliższa</option>
            <option value="payment-desc">Wypłata · najdalsza</option>
          </select>
        </label>
      </div>

      {data?.sourceState ? (
        <p className="corporate-events-state" aria-live="polite">
          {data.sourceState.isRefreshing
            ? "Aktualizowanie oficjalnych komunikatów GPW…"
            : data.sourceState.status === "SUCCESS" && !data.sourceState.isStale && data.sourceState.sourceBackfillComplete
              ? `Ostatnia udana synchronizacja: ${formatSyncTime(data.sourceState.lastSuccessfulSyncAt) ?? "niedawno"}.`
              : data.sourceState.status === "SUCCESS"
                ? `Trwa uzupełnianie archiwum oficjalnych komunikatów. Ostatnia udana synchronizacja: ${formatSyncTime(data.sourceState.lastSuccessfulSyncAt) ?? "niedawno"}.`
                : `Dane mogą być częściowe. Ostatnia udana synchronizacja: ${formatSyncTime(data.sourceState.lastSuccessfulSyncAt) ?? "brak"}.`}
          {!data.sourceState.isRefreshing && (data.sourceState.projectionPending ?? 0) > 0
            ? " Część pobranych komunikatów nadal czeka na weryfikację."
            : ""}
          {!data.sourceState.isRefreshing && ((data.sourceState.projectionErrors ?? 0) > 0 || (data.sourceState.projectionUnmatched ?? 0) > 0)
            ? " Nie wszystkie komunikaty udało się obecnie jednoznacznie przetworzyć."
            : ""}
        </p>
      ) : null}
      {isLoading ? <p className="corporate-events-state">Sprawdzanie zapisanych dywidend…</p> : null}
      {hasError ? <p className="field-note field-note-error">Nie udało się pobrać kalendarza. Ostatnio zapisane dane nie zostały usunięte.</p> : null}
      {!isLoading && !hasError && events.length === 0 ? (
        <p className="corporate-events-state">Brak dywidend spełniających wybrane kryteria.</p>
      ) : null}

      {events.length ? (
        <div className="dividend-calendar-list" aria-label="Nadchodzące dywidendy GPW">
          {events.map((event) => (
            <article className="dividend-calendar-row" key={event.id}>
              <div className="dividend-calendar-issuer">
                <strong>{event.companyName}</strong>
                <span>{event.ticker}</span>
              </div>
              <div className="dividend-calendar-amount">
                <small>Dywidenda na akcję</small>
                <strong>{typeof event.dividendPerShare === "number"
                  ? formatCurrency(event.dividendPerShare, event.dividendCurrency ?? "PLN")
                  : "Kwota nieogłoszona"}</strong>
                {event.dividendInstallment ? <span>Rata {event.dividendInstallment}</span> : null}
              </div>
              <dl className="dividend-calendar-dates">
                <div><dt>Dzień dywidendy</dt><dd>{event.recordDate ? formatDate(event.recordDate) : "Nie ogłoszono"}</dd></div>
                <div><dt>Dzień wypłaty</dt><dd>{event.paymentDate ? formatDate(event.paymentDate) : "Nie ogłoszono"}</dd></div>
              </dl>
              <span className={getStatusClass(event, today)}>{getStatusLabel(event, today)}</span>
              <DividendSources event={event} />
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
