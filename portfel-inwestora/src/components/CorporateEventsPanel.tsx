"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getCorporateEventLabel,
  getDaysUntilWarsawDate,
  isCorporateEventSourceUnavailable,
  CALENDAR_WINDOW_OPTIONS,
  GENERAL_MEETING_WINDOW_DAYS,
  REPORT_WINDOW_DAYS,
  isCalendarWindowDays,
  type CalendarWindowDays,
  type CorporateEvent,
  type CorporateEventsResponse,
  type GeneralMeetingScope,
} from "@/lib/corporate-events";
import { fetchCorporateEvents, fetchGeneralMeetings, fetchGpwReports } from "@/lib/api";

type CorporateEventsPanelProps = {
  portfolioId: string;
  portfolioIds?: string[];
  variant?: "all" | "general-meetings" | "reports";
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
  const days = getDaysUntilWarsawDate(eventDate);
  if (days === 0) return "dzisiaj";
  if (days === 1) return "jutro";
  return `za ${days} dni`;
};

const getRegistrationCountdown = (registrationDate?: string) => {
  if (!registrationDate) return "Nie podano daty rejestracji";
  const days = getDaysUntilWarsawDate(registrationDate);
  if (days < 0) return "Dzień rejestracji minął";
  if (days === 0) return "Dzień rejestracji przypada dzisiaj";
  if (days === 1) return "Pozostał 1 dzień do dnia rejestracji";
  return `Pozostało ${days} dni do dnia rejestracji`;
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

const toEventsResponse = (response: Awaited<ReturnType<typeof fetchGeneralMeetings>>): CorporateEventsResponse => ({
  events: response.events,
  sourceStates: [{
    instrumentId: "global-gpw",
    ticker: "GPW",
    status: response.sourceState.status === "NOT_SYNCED" ? "NOT_FOUND" : response.sourceState.status,
    lastCheckedAt: response.sourceState.lastCheckedAt,
  }],
  scope: "OK",
});

const subscribeCalendarRange = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener("mexo-calendar-range", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("mexo-calendar-range", onChange);
  };
};
const readCalendarRange = (key: string, fallback: CalendarWindowDays) => {
  const value = Number(window.localStorage.getItem(key));
  return isCalendarWindowDays(value) ? value : fallback;
};
const getMeetingRange = () => readCalendarRange("mexo-gpw-meeting-days", GENERAL_MEETING_WINDOW_DAYS);
const getReportRange = () => readCalendarRange("mexo-gpw-report-days", REPORT_WINDOW_DAYS);
const getDefaultMeetingRange = () => GENERAL_MEETING_WINDOW_DAYS;
const getDefaultReportRange = () => REPORT_WINDOW_DAYS;
const readScope = (key: string): GeneralMeetingScope => {
  const value = window.localStorage.getItem(key);
  return value === "watchlist" || value === "portfolio" ? value : "all";
};
const getMeetingScope = () => readScope("mexo-gpw-meeting-scope");
const getReportScope = () => readScope("mexo-gpw-report-scope");
const getDefaultScope = (): GeneralMeetingScope => "all";

export default function CorporateEventsPanel({ portfolioId, portfolioIds, variant = "all" }: CorporateEventsPanelProps) {
  const [data, setData] = useState<CorporateEventsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const meetingScope = useSyncExternalStore(subscribeCalendarRange, getMeetingScope, getDefaultScope);
  const reportScope = useSyncExternalStore(subscribeCalendarRange, getReportScope, getDefaultScope);
  const meetingDays = useSyncExternalStore(subscribeCalendarRange, getMeetingRange, getDefaultMeetingRange);
  const reportDays = useSyncExternalStore(subscribeCalendarRange, getReportRange, getDefaultReportRange);
  const [meetingSyncState, setMeetingSyncState] = useState<Awaited<ReturnType<typeof fetchGeneralMeetings>>["sourceState"] | null>(null);
  const [reportSyncState, setReportSyncState] = useState<Awaited<ReturnType<typeof fetchGpwReports>>["sourceState"] | null>(null);
  const isMeetingView = variant === "general-meetings";
  const isReportView = variant === "reports";
  const portfolioIdsKey = portfolioIds?.join(",") ?? "";
  const requestKey = [variant, isMeetingView ? meetingScope : reportScope, meetingDays, reportDays, portfolioId, portfolioIdsKey].join(":");
  const showingLoading = isLoading || (loadedKey !== requestKey && errorKey !== requestKey);
  const hasError = errorKey === requestKey;

  useEffect(() => {
    const controller = new AbortController();

    const request = isMeetingView
      ? fetchGeneralMeetings({ scope: meetingScope, days: meetingDays, signal: controller.signal })
          .then((response) => {
            if (!controller.signal.aborted) setMeetingSyncState(response.sourceState);
            return toEventsResponse(response);
          })
      : isReportView
        ? fetchGpwReports({ scope: reportScope, days: reportDays, portfolioId,
            portfolioIds: portfolioIdsKey ? portfolioIdsKey.split(",") : undefined, signal: controller.signal })
            .then((response) => {
              if (!controller.signal.aborted) setReportSyncState(response.sourceState);
              return toEventsResponse(response);
            })
      : fetchCorporateEvents({ portfolioId, portfolioIds: portfolioIdsKey ? portfolioIdsKey.split(",") : undefined,
          days: Math.max(meetingDays, reportDays), meetingDays, reportDays, signal: controller.signal });

    void request
      .then((response) => {
        if (!controller.signal.aborted) {
          setData(response);
          setLoadedKey(requestKey);
          setErrorKey(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setErrorKey(requestKey);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [isMeetingView, isReportView, meetingScope, reportScope, meetingDays, reportDays, portfolioId, portfolioIdsKey, requestKey]);

  useEffect(() => {
    if (!isMeetingView || !meetingSyncState?.isRefreshing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetchGeneralMeetings({
          scope: meetingScope,
          days: meetingDays,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setData(toEventsResponse(response));
        setMeetingSyncState(response.sourceState);
        setErrorKey(null);
        if (response.sourceState.isRefreshing) timer = setTimeout(() => void poll(), 8_000);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        // Keep the last saved calendar visible if a background refresh poll
        // fails; the API cache remains the source of truth.
        setMeetingSyncState((current) => current
          ? { ...current, status: "TEMPORARILY_UNAVAILABLE", isRefreshing: false, isStale: true }
          : current);
      }
    };

    timer = setTimeout(() => void poll(), 8_000);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [isMeetingView, meetingScope, meetingDays, meetingSyncState?.isRefreshing]);

  useEffect(() => {
    if (!isReportView || !reportSyncState?.isRefreshing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetchGpwReports({ scope: reportScope, days: reportDays, portfolioId,
          portfolioIds: portfolioIdsKey ? portfolioIdsKey.split(",") : undefined, signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(toEventsResponse(response));
        setReportSyncState(response.sourceState);
        setErrorKey(null);
        if (response.sourceState.isRefreshing) timer = setTimeout(() => void poll(), 8_000);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setReportSyncState((current) => current
          ? { ...current, status: "TEMPORARILY_UNAVAILABLE", isRefreshing: false, isStale: true }
          : current);
      }
    };
    timer = setTimeout(() => void poll(), 8_000);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [isReportView, reportScope, reportDays, portfolioId, portfolioIdsKey, reportSyncState?.isRefreshing]);

  const changeMeetingDays = (days: CalendarWindowDays) => {
    window.localStorage.setItem("mexo-gpw-meeting-days", String(days));
    window.dispatchEvent(new Event("mexo-calendar-range"));
  };
  const changeReportDays = (days: CalendarWindowDays) => {
    window.localStorage.setItem("mexo-gpw-report-days", String(days));
    window.dispatchEvent(new Event("mexo-calendar-range"));
  };

  const changeMeetingScope = (scope: GeneralMeetingScope) => {
    window.localStorage.setItem("mexo-gpw-meeting-scope", scope);
    window.dispatchEvent(new Event("mexo-calendar-range"));
  };
  const changeReportScope = (scope: GeneralMeetingScope) => {
    window.localStorage.setItem("mexo-gpw-report-scope", scope);
    window.dispatchEvent(new Event("mexo-calendar-range"));
  };

  const allSourcesUnavailable =
    data?.sourceStates.length &&
    data.sourceStates.every((source) => isCorporateEventSourceUnavailable(source.status));
  const reportEvents = (data?.events ?? []).filter(
    (event) =>
      event.eventType !== "UPCOMING_DIVIDEND" &&
      (isMeetingView ? event.eventType === "GENERAL_MEETING" :
        !isReportView || event.eventType === "QUARTERLY_REPORT" || event.eventType === "HALF_YEAR_REPORT" || event.eventType === "ANNUAL_REPORT") &&
      event.active !== false &&
      event.status !== "CANCELLED"
  );
  return (
    <section className="panel panel-compact corporate-events-panel" aria-busy={showingLoading}>
      <div className="corporate-events-head">
        <div>
          <p className="eyebrow">Kalendarz GPW</p>
          <h2 className="section-title">{isMeetingView ? "Walne zgromadzenia" : isReportView ? "Raporty" : "Wydarzenia GPW"}</h2>
        </div>
        <span className="tag">{isMeetingView ? `ZWZ i NWZ · ${meetingDays} dni` : isReportView ? `raporty · ${reportDays} dni` : `raporty ${reportDays} dni · WZA ${meetingDays} dni`}</span>
      </div>

      <div className="corporate-events-ranges">
        {!isMeetingView && (
          <div className="corporate-events-range" role="group" aria-label="Zakres raportów okresowych">
            <span>Raporty</span>
            {CALENDAR_WINDOW_OPTIONS.map((days) => <button key={days} type="button" className={reportDays === days ? "is-active" : undefined}
              aria-pressed={reportDays === days} onClick={() => changeReportDays(days)}>{days} dni</button>)}
          </div>
        )}
        {!isReportView && <div className="corporate-events-range" role="group" aria-label="Zakres walnych zgromadzeń">
          <span>WZA</span>
          {CALENDAR_WINDOW_OPTIONS.map((days) => <button key={days} type="button" className={meetingDays === days ? "is-active" : undefined}
            aria-pressed={meetingDays === days} onClick={() => changeMeetingDays(days)}>{days} dni</button>)}
        </div>}
      </div>

      {isMeetingView || isReportView ? (
        <div className="corporate-events-scope" role="group" aria-label={isMeetingView ? "Zakres walnych zgromadzeń" : "Zakres raportów"}>
          {([
            ["all", "Wszystkie"],
            ["watchlist", "Obserwowane"],
            ["portfolio", "W portfelu"],
          ] as const).map(([scope, label]) => (
            <button
              className={(isMeetingView ? meetingScope : reportScope) === scope ? "is-active" : undefined}
              key={scope}
              type="button"
              aria-pressed={(isMeetingView ? meetingScope : reportScope) === scope}
              onClick={() => (isMeetingView ? changeMeetingScope : changeReportScope)(scope)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {isMeetingView && meetingSyncState ? (
        <p className="corporate-events-state" aria-live="polite">
          {meetingSyncState.isRefreshing
            ? "Odświeżanie i uzupełnianie kalendarza GPW; nowe terminy będą pojawiać się na bieżąco…"
            : meetingSyncState.status === "SUCCESS" && !meetingSyncState.isStale
              ? `Ostatnie sprawdzenie oficjalnego źródła: ${formatSyncTime(meetingSyncState.lastSuccessfulSyncAt) ?? "niedawno"}.`
              : `Dane mogą być częściowe. Ostatnie sprawdzenie źródła: ${formatSyncTime(meetingSyncState.lastSuccessfulSyncAt) ?? "brak"}.`}
          {meetingSyncState.projectionPending ? ` Pozostałe oficjalne raporty do weryfikacji: ${meetingSyncState.projectionPending}.` : ""}
        </p>
      ) : null}
      {isReportView && reportSyncState ? (
        <p className="corporate-events-state" aria-live="polite">
          {reportSyncState.isRefreshing
            ? "Odświeżanie oficjalnych harmonogramów raportów GPW…"
            : reportSyncState.status === "SUCCESS" && !reportSyncState.isStale
              ? `Ostatnie sprawdzenie źródła: ${formatSyncTime(reportSyncState.lastSuccessfulSyncAt) ?? "niedawno"}.`
              : `Dane mogą być częściowe. Ostatnie udane sprawdzenie: ${formatSyncTime(reportSyncState.lastSuccessfulSyncAt) ?? "brak"}.`}
          {reportSyncState.sourceBackfillComplete === false ? " Trwa uzupełnianie archiwum komunikatów." : ""}
        </p>
      ) : null}

      {showingLoading ? <p className="corporate-events-state">Sprawdzanie zapisanych wydarzeń…</p> : null}
      {hasError ? (
        <p className="field-note field-note-error mt-4">Nie udało się pobrać wydarzeń GPW. Spróbuj ponownie później.</p>
      ) : null}

      {!isMeetingView && !showingLoading && !hasError && data?.scope === "NO_GPW_INSTRUMENTS" ? (
        <p className="corporate-events-state">Brak obecnie posiadanych lub obserwowanych spółek GPW.</p>
      ) : null}

      {!showingLoading && !hasError && data?.scope === "OK" && reportEvents.length === 0 ? (
        <p className="corporate-events-state">
          {allSourcesUnavailable
            ? "Źródła wydarzeń są chwilowo niedostępne. Zachowamy ostatnie potwierdzone terminy, gdy będą dostępne."
            : isMeetingView
              ? meetingScope === "all"
                ? "Brak nadchodzących walnych zgromadzeń w aktualnie obsługiwanym rynku GPW."
                : meetingScope === "watchlist"
                  ? "Brak nadchodzących walnych zgromadzeń dla obserwowanych spółek."
                  : "Brak nadchodzących walnych zgromadzeń dla spółek w portfelu."
              : isReportView
                ? (reportScope === "all" ? "Brak potwierdzonych terminów raportów w wybranym okresie." :
                  reportScope === "watchlist" ? "Brak terminów raportów dla obserwowanych spółek." :
                  "Brak terminów raportów dla spółek w portfelu.")
                : "Brak potwierdzonych przyszłych wydarzeń dla śledzonych spółek."}
        </p>
      ) : null}

      {!showingLoading && !hasError && reportEvents.length ? (
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
                  {event.ticker ? <small className="corporate-event-ticker">{event.ticker}</small> : null}
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
                  {isGeneralMeeting ? (
                    <div className={`corporate-event-registration ${registrationDate ? "has-date" : "is-missing"}`}>
                      <span className="corporate-event-registration-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false"><path d="M7 2v3m10-3v3M4 9h16M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Zm3 9h3v3H8v-3Z" /></svg>
                      </span>
                      <span className="corporate-event-registration-copy">
                        <strong>Dzień rejestracji uczestnictwa</strong>
                        {registrationDate ? <time dateTime={event.registrationDate}>{registrationDate.long}</time> : <span>Nie podano</span>}
                        <small>{getRegistrationCountdown(event.registrationDate)}</small>
                        <small>{event.registrationDateSource === "OFFICIAL" ? "Data z oficjalnego ogłoszenia" :
                          event.registrationDateSource === "STATUTORY_CALCULATION" ? "Wyliczono: 16 dni kalendarzowych przed WZA (art. 406¹ KSH)" : "Nie ustalono źródła daty"}</small>
                        {event.registrationDateConflict ? <small>Uwaga: data ogłoszona różni się od terminu wyliczonego ustawowo. Sprawdź ogłoszenie.</small> : null}
                      </span>
                      <small className="corporate-event-registration-guidance">Żądanie imiennego zaświadczenia składa się najpóźniej w pierwszym dniu powszednim po dniu rejestracji (art. 406³ KSH). Broker może mieć wcześniejszą godzinę graniczną.</small>
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
