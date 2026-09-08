"use client";

import { useEffect, useState } from "react";
import {
  getCorporateEventLabel,
  getDaysUntilCorporateEvent,
  isCorporateEventSourceUnavailable,
  type CorporateEvent,
  type CorporateEventsResponse,
  type GeneralMeetingScope,
} from "@/lib/corporate-events";
import { fetchCorporateEvents, fetchGeneralMeetings } from "@/lib/api";

type CorporateEventsPanelProps = {
  portfolioId: string;
  variant?: "all" | "general-meetings";
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

const formatEventTime = (eventTime: string) => {
  const match = eventTime.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : eventTime;
};

const getEventStatusLabel = (event: CorporateEvent) => {
  if (event.status === "CHANGED") return "Termin zmieniony";
  if (event.status === "CONFIRMED") return "Termin potwierdzony";
  return null;
};

export default function CorporateEventsPanel({ portfolioId, variant = "all" }: CorporateEventsPanelProps) {
  const [data, setData] = useState<CorporateEventsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [meetingScope, setMeetingScope] = useState<GeneralMeetingScope>("all");
  const isMeetingView = variant === "general-meetings";

  useEffect(() => {
    const controller = new AbortController();

    const request = isMeetingView
      ? fetchGeneralMeetings({ scope: meetingScope, days: 365, signal: controller.signal })
          .then((response): CorporateEventsResponse => ({
            events: response.events,
            sourceStates: [{
              instrumentId: "global-gpw",
              ticker: "GPW",
              status: response.sourceState.status === "NOT_SYNCED" ? "NOT_FOUND" : response.sourceState.status,
              lastCheckedAt: response.sourceState.lastCheckedAt,
            }],
            scope: "OK",
          }))
      : fetchCorporateEvents({ portfolioId, days: 60, signal: controller.signal });

    void request
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
  }, [isMeetingView, meetingScope, portfolioId]);

  const changeMeetingScope = (scope: GeneralMeetingScope) => {
    setIsLoading(true);
    setHasError(false);
    setMeetingScope(scope);
  };

  const allSourcesUnavailable =
    data?.sourceStates.length &&
    data.sourceStates.every((source) => isCorporateEventSourceUnavailable(source.status));
  const reportEvents = (data?.events ?? []).filter(
    (event) =>
      event.eventType !== "UPCOMING_DIVIDEND" &&
      (variant !== "general-meetings" || event.eventType === "GENERAL_MEETING") &&
      event.active !== false &&
      event.status !== "CANCELLED"
  );
  return (
    <section className="panel panel-compact corporate-events-panel" aria-busy={isLoading}>
      <div className="corporate-events-head">
        <div>
          <p className="eyebrow">Kalendarz GPW</p>
          <h2 className="section-title">{isMeetingView ? "Walne zgromadzenia" : "Wydarzenia GPW"}</h2>
        </div>
        <span className="tag">{isMeetingView ? "ZWZ i NWZ · 12 miesięcy" : "raporty · WZA · 60 dni"}</span>
      </div>

      {isMeetingView ? (
        <div className="corporate-events-scope" role="group" aria-label="Zakres walnych zgromadzeń">
          {([
            ["all", "Wszystkie"],
            ["watchlist", "Obserwowane"],
            ["portfolio", "W portfelu"],
          ] as const).map(([scope, label]) => (
            <button
              className={meetingScope === scope ? "is-active" : undefined}
              key={scope}
              type="button"
              aria-pressed={meetingScope === scope}
              onClick={() => changeMeetingScope(scope)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {isLoading ? <p className="corporate-events-state">Sprawdzanie zapisanych wydarzeń…</p> : null}
      {hasError ? (
        <p className="field-note field-note-error mt-4">Nie udało się pobrać wydarzeń GPW. Spróbuj ponownie później.</p>
      ) : null}

      {!isMeetingView && !isLoading && !hasError && data?.scope === "NO_GPW_INSTRUMENTS" ? (
        <p className="corporate-events-state">Brak obecnie posiadanych lub obserwowanych spółek GPW.</p>
      ) : null}

      {!isLoading && !hasError && data?.scope === "OK" && reportEvents.length === 0 ? (
        <p className="corporate-events-state">
          {allSourcesUnavailable
            ? "Źródła wydarzeń są chwilowo niedostępne. Zachowamy ostatnie potwierdzone terminy, gdy będą dostępne."
            : isMeetingView
              ? meetingScope === "all"
                ? "Brak nadchodzących walnych zgromadzeń w aktualnie obsługiwanym rynku GPW."
                : meetingScope === "watchlist"
                  ? "Brak nadchodzących walnych zgromadzeń dla obserwowanych spółek."
                  : "Brak nadchodzących walnych zgromadzeń dla spółek w portfelu."
              : "Brak potwierdzonych przyszłych wydarzeń dla śledzonych spółek."}
        </p>
      ) : null}

      {reportEvents.length ? (
        <div className="corporate-events-list" aria-label={isMeetingView ? "Nadchodzące walne zgromadzenia" : "Nadchodzące wydarzenia"}>
          {reportEvents.map((event) => {
            const date = formatEventDateParts(event.eventDate);
            const statusLabel = getEventStatusLabel(event);
            const isGeneralMeeting = event.eventType === "GENERAL_MEETING";
            const registrationDate = event.registrationDate
              ? formatEventDateParts(event.registrationDate)
              : null;

            return (
              <article className="corporate-event-row" key={event.id}>
                <time className="corporate-event-date" dateTime={event.eventDate}>
                  <strong>{date.day}</strong>
                  <span>{date.month}</span>
                </time>
                <div className="corporate-event-copy">
                  <strong>{event.companyName}</strong>
                  <div className="corporate-event-title-line">
                    <span>{getCorporateEventLabel(event)}</span>
                    {isGeneralMeeting && event.generalMeetingType ? (
                      <abbr title={event.generalMeetingType === "ZWZ" ? "Zwyczajne Walne Zgromadzenie" : "Nadzwyczajne Walne Zgromadzenie"}>
                        {event.generalMeetingType}
                      </abbr>
                    ) : null}
                  </div>
                  <small className="corporate-event-schedule">
                    <span>{date.long}</span>
                    {event.eventTime ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <time dateTime={`${event.eventDate}T${event.eventTime}`}>
                          godz. {formatEventTime(event.eventTime)}
                        </time>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span>{getRelativeDateLabel(event.eventDate)}</span>
                    {statusLabel ? (
                      <span className={`corporate-event-status is-${event.status.toLocaleLowerCase()}`}>
                        {statusLabel}
                      </span>
                    ) : null}
                  </small>
                  {isGeneralMeeting && registrationDate ? (
                    <div className="corporate-event-registration">
                      <span>
                        Dzień rejestracji: <time dateTime={event.registrationDate}>{registrationDate.long}</time>
                      </span>
                      <small>16 dni przed WZA · szczegóły uczestnictwa sprawdź u brokera</small>
                    </div>
                  ) : null}
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
