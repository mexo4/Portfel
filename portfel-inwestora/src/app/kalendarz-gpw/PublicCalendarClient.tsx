"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildGpwCalendarGrid,
  getCalendarMonth,
  getGpwCalendarHref,
  getGpwEventCategory,
  getGpwEventLabel,
  getGpwEventStatusLabel,
  groupGpwEventsByDate,
  normalizeCompanySearch,
  parseCalendarCategory,
  type GpwCalendarCategory,
  type PublicGpwCalendarEvent,
} from "@/lib/public-gpw-calendar";
import styles from "./page.module.css";

type CalendarMonth = ReturnType<typeof getCalendarMonth>;
const WEEKDAYS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Niedz"];
const OPTIONS: { value: GpwCalendarCategory; label: string }[] = [
  { value: "all", label: "Wszystkie wydarzenia" },
  { value: "reports", label: "Raporty okresowe" },
  { value: "meetings", label: "Walne zgromadzenia" },
  { value: "dividends", label: "Dywidendy" },
];
const formatDate = (isoDate: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("pl-PL", { ...options, timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));
const formatPublishedAt = (date: string) => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "nieznana" :
    new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" }).format(parsed);
};

function EventCard({ event }: { event: PublicGpwCalendarEvent }) {
  const type = getGpwEventCategory(event.kind);
  const amount = event.dividendPerShare === undefined ? null :
    `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 4 }).format(event.dividendPerShare)} ${event.dividendCurrency || "PLN"} / akcję`;
  return (
    <article className={styles.eventCard}>
      <span className={`${styles.typeStripe} ${styles[`stripe_${type}`]}`} aria-hidden="true" />
      <div className={styles.eventBody}>
        <div className={styles.eventHeading}>
          <span className={styles.company}>{event.companyName} <span className={styles.ticker}>{event.ticker}</span></span>
          <span className={`${styles.eventType} ${styles[`type_${type}`]}`}>{type === "reports" ? "RAPORT" : type === "meetings" ? "WZA" : "DYWIDENDA"}</span>
        </div>
        <div className={styles.eventName}>{getGpwEventLabel(event)}</div>
        <div className={styles.eventMeta}>
          {event.time ? <span>Godz. {event.time}</span> : null}
          {event.status === "PROPOSED" || event.status === "CHANGED" || event.status === "UNKNOWN"
            ? <span className={styles.status}>{getGpwEventStatusLabel(event.status)}</span> : null}
          {amount ? <span>{amount}</span> : null}
          {event.kind === "GENERAL_MEETING" && event.registrationDate ? <span>Rejestracja: {formatDate(event.registrationDate, { day: "numeric", month: "short" })}</span> : null}
        </div>
        <div className={styles.sourceRow}>
          <a className={styles.sourceLink} href={event.sourceUrl} target="_blank" rel="noopener noreferrer nofollow"
            aria-label={`Oficjalne źródło: ${event.companyName}, ${getGpwEventLabel(event)}`}>Źródło <span aria-hidden="true">↗</span></a>
          {event.sourcePublishedAt ? <span>Publikacja: {formatPublishedAt(event.sourcePublishedAt)}</span> : null}
        </div>
      </div>
    </article>
  );
}

export default function PublicCalendarClient({ month, category, company, events, sourceUnavailable }: {
  month: CalendarMonth;
  category: GpwCalendarCategory;
  company: string;
  events: PublicGpwCalendarEvent[];
  sourceUnavailable: boolean;
}) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const calendarDays = buildGpwCalendarGrid(month, events);
  const allEventDays = groupGpwEventsByDate(events);
  const selectedEvents = selectedDate ? events.filter((event) => event.date === selectedDate) : null;
  const eventDays = selectedDate ? allEventDays.filter((day) => day.date === selectedDate) : allEventDays;
  const totals = {
    reports: events.filter((event) => getGpwEventCategory(event.kind) === "reports").length,
    meetings: events.filter((event) => getGpwEventCategory(event.kind) === "meetings").length,
    dividends: events.filter((event) => getGpwEventCategory(event.kind) === "dividends").length,
  };
  const navigate = () => setSelectedDate(null);
  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const search = normalizeCompanySearch(String(form.get("spolka") ?? ""));
    const nextCategory = parseCalendarCategory(String(form.get("typ") ?? "all"));
    navigate();
    router.push(getGpwCalendarHref(month.key, nextCategory, search), { scroll: false });
  };

  return (
    <>
      <form className={styles.filters} onSubmit={submitFilters} role="search">
        <label className={styles.filterField}><span>Spółka / ticker</span><input name="spolka" type="search" maxLength={64} defaultValue={company} placeholder="Np. Orlen, DNP..." autoComplete="off" /></label>
        <label className={styles.filterField}><span>Typ wydarzenia</span><select name="typ" defaultValue={category}>{OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <button type="submit" className={styles.filterSubmit}>Filtruj <span aria-hidden="true">→</span></button>
        {company || category !== "all" ? <Link scroll={false} onClick={navigate} href={getGpwCalendarHref(month.key, "all", "")} className={styles.clearFilters}>Wyczyść</Link> : null}
      </form>

      <div className={styles.metrics} aria-label="Liczba wydarzeń w wybranym miesiącu">
        <div><span>WYDARZENIA</span><strong>{sourceUnavailable ? "—" : events.length}</strong></div>
        <div><span>RAPORTY</span><strong>{sourceUnavailable ? "—" : totals.reports}</strong></div>
        <div><span>WALNE ZGROMADZENIA</span><strong>{sourceUnavailable ? "—" : totals.meetings}</strong></div>
        <div><span>DYWIDENDY</span><strong>{sourceUnavailable ? "—" : totals.dividends}</strong></div>
      </div>

      <div className={styles.contentGrid}>
        <section className={styles.calendarPanel} aria-label={`Kalendarz na ${month.label}`}>
          <div className={styles.monthToolbar}>
            <div><p>WYBRANY MIESIĄC</p><h3>{month.label}</h3></div>
            <div className={styles.monthButtons}>
              <Link scroll={false} onClick={navigate} aria-label="Poprzedni miesiąc" href={getGpwCalendarHref(month.prevKey, category, company)} className={styles.monthButton}>‹</Link>
              <Link scroll={false} onClick={navigate} href={getGpwCalendarHref(getCalendarMonth(undefined).key, category, company)} className={styles.todayButton}>Dziś</Link>
              <Link scroll={false} onClick={navigate} aria-label="Następny miesiąc" href={getGpwCalendarHref(month.nextKey, category, company)} className={styles.monthButton}>›</Link>
            </div>
          </div>
          <div className={styles.calendarGrid} aria-label={month.label}>
            {WEEKDAYS.map((weekday) => <div key={weekday} className={styles.weekday}>{weekday}</div>)}
            {calendarDays.map((day) => day.inMonth ? (
              <button type="button" key={day.date} aria-label={`${formatDate(day.date)}: ${day.events.length} wydarzeń`}
                aria-pressed={selectedDate === day.date} onClick={() => setSelectedDate(day.date)}
                className={`${styles.calendarCell} ${day.date === month.todayKey ? styles.currentDay : ""} ${selectedDate === day.date ? styles.selectedDay : ""}`}>
                <span className={styles.dayNumber}>{day.day}</span>
                {day.events.length ? <span className={styles.dayEvents} aria-hidden="true">
                  {day.events.slice(0, 3).map((event) => <span key={event.id} className={`${styles.eventDot} ${styles[`dot_${getGpwEventCategory(event.kind)}`]}`} />)}
                  <small>{day.events.length}</small>
                </span> : null}
              </button>
            ) : <div key={day.date} aria-hidden="true" className={`${styles.calendarCell} ${styles.outsideMonth}`}><span className={styles.dayNumber}>{day.day}</span></div>)}
          </div>
          <div className={styles.legend}>
            <span><i className={styles.dot_reports} /> Raporty</span>
            <span><i className={styles.dot_meetings} /> WZA / NWZA</span>
            <span><i className={styles.dot_dividends} /> Dywidendy</span>
          </div>
          <p className={styles.calendarNote}>Daty prezentowane w polskiej strefie czasowej. Wydarzenie pojawia się dopiero po jego ogłoszeniu i wykryciu w źródłach.</p>
        </section>

        <section className={styles.agendaPanel} aria-labelledby="agenda-title" aria-live="polite">
          <div className={styles.agendaHeading}>
            <div><p>HARMONOGRAM</p><h3 id="agenda-title">{selectedDate ? formatDate(selectedDate) : "Najbliżej w miesiącu"}</h3></div>
            <span>{selectedEvents ? selectedEvents.length : events.length} pozycji</span>
          </div>
          <div className={styles.agendaScroll}>
            {sourceUnavailable ? <div className={styles.empty}><strong>Źródło chwilowo niedostępne</strong><p>Nie udało się odczytać danych. To nie oznacza braku wydarzeń. Spróbuj ponownie za chwilę.</p></div> :
              selectedDate && selectedEvents?.length === 0 ? <div className={styles.empty}><strong>Brak wydarzeń w wybranym dniu</strong><p>Wybierz inną datę lub przejrzyj cały miesiąc.</p></div> :
              eventDays.length === 0 ? <div className={styles.empty}><strong>Brak wydarzeń spełniających warunki</strong><p>Nie znaleźliśmy zweryfikowanych pozycji dla tego miesiąca i filtrów. Sprawdź inny miesiąc lub usuń filtry.</p></div> :
              eventDays.map((day) => (
                <div className={styles.agendaDay} key={day.date}>
                  <div className={styles.agendaDate}><strong>{formatDate(day.date, { day: "2-digit" })}</strong><span>{formatDate(day.date, { weekday: "long", month: "long" })}</span></div>
                  <div className={styles.dayList}>{day.events.map((event) => <EventCard key={event.id} event={event} />)}</div>
                </div>
              ))}
          </div>
          {selectedDate ? <button type="button" className={styles.showAll} onClick={() => setSelectedDate(null)}>Pokaż cały miesiąc</button> : null}
        </section>
      </div>
    </>
  );
}
