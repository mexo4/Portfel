"use client";

import { useEffect, useState } from "react";
import {
  getCorporateEventLabel,
  getDaysUntilCorporateEvent,
  isCorporateEventSourceUnavailable,
  type CorporateEventsResponse,
} from "@/lib/corporate-events";
import { fetchCorporateEvents } from "@/lib/api";

type CorporateEventsPanelProps = {
  portfolioId: string;
};

const formatEventDateParts = (date: string) => {
  const value = new Date(`${date}T00:00:00`);
  return {
    day: new Intl.DateTimeFormat("pl-PL", { day: "2-digit" }).format(value),
    month: new Intl.DateTimeFormat("pl-PL", { month: "short" })
      .format(value)
      .replace(".", "")
      .toUpperCase(),
    long: new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(value),
  };
};

const getRelativeDateLabel = (eventDate: string) => {
  const days = getDaysUntilCorporateEvent(eventDate);
  if (days === 0) return "dzisiaj";
  if (days === 1) return "jutro";
  return `za ${days} dni`;
};

export default function CorporateEventsPanel({ portfolioId }: CorporateEventsPanelProps) {
  const [data, setData] = useState<CorporateEventsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetchCorporateEvents({ portfolioId, days: 60, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setData(response);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [portfolioId]);

  const allSourcesUnavailable =
    data?.sourceStates.length &&
    data.sourceStates.every((source) => isCorporateEventSourceUnavailable(source.status));

  return (
    <section className="panel panel-compact corporate-events-panel" aria-busy={isLoading}>
      <div className="corporate-events-head">
        <div>
          <p className="eyebrow">Kalendarz GPW</p>
          <h2 className="section-title">Wydarzenia GPW</h2>
        </div>
        <span className="tag">najbliższe 60 dni</span>
      </div>

      {isLoading ? <p className="corporate-events-state">Sprawdzanie zapisanych terminów…</p> : null}
      {hasError ? (
        <p className="field-note field-note-error mt-4">Nie udało się pobrać wydarzeń GPW. Spróbuj ponownie później.</p>
      ) : null}

      {!isLoading && !hasError && data?.scope === "NO_GPW_INSTRUMENTS" ? (
        <p className="corporate-events-state">Ten portfel nie zawiera obecnie polskich akcji GPW.</p>
      ) : null}

      {!isLoading && !hasError && data?.scope === "OK" && data.events.length === 0 ? (
        <p className="corporate-events-state">
          {allSourcesUnavailable
            ? "Źródła wydarzeń są chwilowo niedostępne. Zachowamy ostatnie potwierdzone terminy, gdy będą dostępne."
            : "Brak potwierdzonych przyszłych terminów raportów dla posiadanych spółek."}
        </p>
      ) : null}

      {data?.events.length ? (
        <div className="corporate-events-list" aria-label="Nadchodzące wydarzenia">
          {data.events.map((event) => {
            const date = formatEventDateParts(event.eventDate);
            const isConfirmed = event.status === "CONFIRMED" || event.status === "CHANGED";

            return (
              <article className="corporate-event-row" key={event.id}>
                <time className="corporate-event-date" dateTime={event.eventDate}>
                  <strong>{date.day}</strong>
                  <span>{date.month}</span>
                </time>
                <div className="corporate-event-copy">
                  <strong>{event.companyName}</strong>
                  <span>{getCorporateEventLabel(event)}</span>
                  <small>
                    {date.long} · {getRelativeDateLabel(event.eventDate)}
                    {isConfirmed ? " · Termin potwierdzony" : ""}
                  </small>
                </div>
                {event.source?.sourceUrl ? (
                  <a
                    className="corporate-event-source"
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
