"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getUpcomingDividendDatesForDisplay,
  getUpcomingDividendRelevantDate,
  isCorporateEventSourceUnavailable,
  type CorporateEvent,
  type CorporateEventsResponse,
} from "@/lib/corporate-events";
import { fetchCorporateEvents } from "@/lib/api";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

type UpcomingDividendsPanelProps = {
  portfolioId: string;
};

const getStatusLabel = (event: CorporateEvent) => {
  if (event.status === "CONFIRMED") return "Zatwierdzona";
  if (event.status === "PROPOSED") return "Propozycja";
  return "Niepotwierdzona";
};

const getStatusClassName = (event: CorporateEvent) =>
  event.status === "CONFIRMED"
    ? "upcoming-dividend-status is-confirmed"
    : event.status === "PROPOSED"
      ? "upcoming-dividend-status is-proposed"
      : "upcoming-dividend-status";

export default function UpcomingDividendsPanel({ portfolioId }: UpcomingDividendsPanelProps) {
  const [data, setData] = useState<CorporateEventsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetchCorporateEvents({ portfolioId, days: 365, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setData(response);
          setHasError(false);
        }
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
  }, [portfolioId]);

  const dividends = useMemo(
    () =>
      (data?.events ?? [])
        .filter(
          (event) =>
            event.eventType === "UPCOMING_DIVIDEND" &&
            typeof event.dividendPerShare === "number" &&
            event.dividendPerShare > 0 &&
            Boolean(getUpcomingDividendRelevantDate(event))
        )
        .sort(
          (left, right) =>
            (getUpcomingDividendRelevantDate(left) ?? "").localeCompare(
              getUpcomingDividendRelevantDate(right) ?? ""
            ) ||
            left.companyName.localeCompare(right.companyName, "pl")
        ),
    [data?.events]
  );
  const allSourcesUnavailable =
    data?.sourceStates.length &&
    data.sourceStates.every((source) => isCorporateEventSourceUnavailable(source.status));

  return (
    <section className="panel upcoming-dividends-panel" aria-busy={isLoading}>
      <div className="upcoming-dividends-head">
        <div>
          <p className="eyebrow">Corporate Events GPW</p>
          <h2 className="section-title">Nadchodzące dywidendy</h2>
          <p className="section-copy">
            Informacja z oficjalnych źródeł GPW. Nie tworzy operacji ani nie zmienia salda gotówki.
          </p>
        </div>
        {dividends.length ? <span className="tag">{dividends.length} {dividends.length === 1 ? "wypłata" : "wypłaty"}</span> : null}
      </div>

      {isLoading ? <p className="corporate-events-state">Sprawdzanie oficjalnych komunikatów…</p> : null}
      {hasError ? (
        <p className="field-note field-note-error">Nie udało się pobrać nadchodzących dywidend. Spróbuj ponownie później.</p>
      ) : null}
      {!isLoading && !hasError && data?.scope === "NO_GPW_INSTRUMENTS" ? (
        <p className="corporate-events-state">Ten portfel nie zawiera obecnie polskich akcji GPW.</p>
      ) : null}
      {!isLoading && !hasError && data?.scope === "OK" && dividends.length === 0 ? (
        <p className="corporate-events-state">
          {allSourcesUnavailable
            ? "Oficjalne źródła są chwilowo niedostępne. Zachowamy ostatnie potwierdzone wydarzenia, gdy źródła wrócą."
            : "Brak potwierdzonych przyszłych dywidend dla posiadanych spółek GPW."}
        </p>
      ) : null}

      {dividends.length ? (
        <div className="upcoming-dividends-list" aria-label="Przyszłe dywidendy">
          {dividends.map((event) => {
            const quantity = event.heldQuantity ?? 0;
            const currency = event.dividendCurrency ?? "PLN";
            const estimatedAmount = quantity * (event.dividendPerShare ?? 0);
            const dates = getUpcomingDividendDatesForDisplay(event);

            return (
              <article className="upcoming-dividend-row" key={event.id}>
                <div className="upcoming-dividend-issuer">
                  <strong>{event.companyName}</strong>
                  <span>{event.ticker}</span>
                </div>
                <div className="upcoming-dividend-rate">
                  <strong>{formatCurrency(event.dividendPerShare ?? 0, currency)} / akcję</strong>
                  <span className={getStatusClassName(event)}>{getStatusLabel(event)}</span>
                </div>
                <div className="upcoming-dividend-position">
                  <span>{formatNumber(quantity)} akcji</span>
                  <strong>Szacowana dywidenda: {formatCurrency(estimatedAmount, currency)}</strong>
                </div>
                <div className="upcoming-dividend-dates">
                  {dates.exDividendDate ? <span>Ex-date: <strong>{formatDate(dates.exDividendDate)}</strong></span> : null}
                  {dates.recordDate ? <span>Record date: <strong>{formatDate(dates.recordDate)}</strong></span> : null}
                  {dates.paymentDate ? <span>Wypłata: <strong>{formatDate(dates.paymentDate)}</strong></span> : null}
                </div>
                {event.source?.sourceUrl ? (
                  <a
                    className="corporate-event-source upcoming-dividend-source"
                    href={event.source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Źródło
                  </a>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
