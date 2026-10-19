import type { Metadata } from "next";
import Link from "next/link";
import PublicCalendarSubscription from "@/components/PublicCalendarSubscription";
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
import { getPublicGpwCalendarMonth } from "@/lib/server/public-gpw-calendar";
import styles from "./page.module.css";

const SITE_URL = "https://mexo.com.pl";
const PAGE_PATH = "/kalendarz-gpw";
const DISPLAY_CATEGORY_OPTIONS: { value: GpwCalendarCategory; label: string }[] = [
  { value: "all", label: "Wszystkie wydarzenia" },
  { value: "reports", label: "Raporty okresowe" },
  { value: "meetings", label: "Walne zgromadzenia" },
  { value: "dividends", label: "Dywidendy" },
];

// Enable indexing only after reviewing public-data redistribution rights and source completeness.
export const metadata: Metadata = {
  title: "Kalendarz GPW – raporty, dywidendy, WZA i NWZA | Mexo",
  description: "Kalendarz wydarzeń spółek GPW. Terminy raportów okresowych, dywidend i walnych zgromadzeń z odnośnikami do źródeł. Sprawdź nadchodzące wydarzenia w Mexo.",
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  robots: { index: process.env.MEXO_PUBLIC_GPW_CALENDAR_INDEXABLE === "true", follow: true },
  openGraph: {
    title: "Kalendarz GPW | Mexo",
    description: "Raporty okresowe, dywidendy, ZWZ i NWZ na jednym kalendarzu. Terminy i linki do źródeł.",
    url: `${SITE_URL}${PAGE_PATH}`,
    siteName: "Mexo",
    locale: "pl_PL",
    type: "website",
  },
};

const WEEKDAYS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Niedz"];
const formatDate = (isoDate: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("pl-PL", { ...options, timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));
const formatPublishedAt = (date: string) => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "nieznana" :
    new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" }).format(parsed);
};
const amountLabel = (event: PublicGpwCalendarEvent) => {
  if (event.dividendPerShare === undefined) return null;
  const currency = event.dividendCurrency || "PLN";
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 4 }).format(event.dividendPerShare)} ${currency} / akcję`;
};

function SourceLink({ event }: { event: PublicGpwCalendarEvent }) {
  return (
    <a className={styles.sourceLink} href={event.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Oficjalne źródło: ${event.companyName}, ${getGpwEventLabel(event)}`}>
      Źródło <span aria-hidden="true">↗</span>
    </a>
  );
}

function EventCard({ event }: { event: PublicGpwCalendarEvent }) {
  const type = getGpwEventCategory(event.kind);
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
            ? <span className={styles.status}>{getGpwEventStatusLabel(event.status)}</span>
            : null}
          {amountLabel(event) ? <span>{amountLabel(event)}</span> : null}
          {event.kind === "GENERAL_MEETING" && event.registrationDate ? <span>Rejestracja: {formatDate(event.registrationDate, { day: "numeric", month: "short" })}</span> : null}
        </div>
        <div className={styles.sourceRow}><SourceLink event={event} />
          {event.sourcePublishedAt ? <span>Publikacja: {formatPublishedAt(event.sourcePublishedAt)}</span> : null}
        </div>
      </div>
    </article>
  );
}

type PageProps = {
  searchParams: Promise<{ miesiac?: string | string[]; typ?: string | string[]; spolka?: string | string[] }>;
};
const pickFirst = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function PublicGpwCalendarPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = getCalendarMonth(pickFirst(params.miesiac));
  const category = parseCalendarCategory(pickFirst(params.typ));
  const company = normalizeCompanySearch(pickFirst(params.spolka));

  let events: PublicGpwCalendarEvent[] = [];
  let lastUpdated: string | undefined;
  let truncated = false;
  let sourceUnavailable = false;
  try {
    const result = await getPublicGpwCalendarMonth(month.start, month.end, category, company);
    events = result.events;
    lastUpdated = result.latestRecordUpdatedAt;
    truncated = result.truncated;
  } catch (error) {
    sourceUnavailable = true;
    console.error("[public-gpw-calendar] unable to read public GPW events", error instanceof Error ? error.name : "unknown");
  }

  const calendarDays = buildGpwCalendarGrid(month, events);
  const eventDays = groupGpwEventsByDate(events);
  const totals = {
    reports: events.filter((event) => getGpwEventCategory(event.kind) === "reports").length,
    meetings: events.filter((event) => getGpwEventCategory(event.kind) === "meetings").length,
    dividends: events.filter((event) => getGpwEventCategory(event.kind) === "dividends").length,
  };
  const prevHref = getGpwCalendarHref(month.prevKey, category, company);
  const nextHref = getGpwCalendarHref(month.nextKey, category, company);
  const resetHref = getGpwCalendarHref(month.key, "all", "");

  return (
    <main className="marketing-shell">
      <nav className="marketing-nav" aria-label="Nawigacja Mexo">
        <Link href="/" className="brand-link">Mexo<span className={styles.brandDot}>.</span></Link>
        <div className="marketing-nav-actions">
          <Link className={styles.navSecondary} href="/narzedzia/procent-skladany">Narzędzia</Link>
          <Link className={styles.navSecondary} href="/pricing">Cennik</Link>
          <Link className="primary-button" href="/register">Załóż konto</Link>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><span className={styles.liveDot} aria-hidden="true" /> NARZĘDZIA INWESTORA / GPW</div>
          <h1>Rynek ma swój <span>kalendarz.</span><br />Ty masz Mexo.</h1>
          <p>Raporty okresowe, dywidendy i walne zgromadzenia spółek z głównego rynku GPW w jednym miejscu. Sprawdzaj daty, filtruj wydarzenia i przechodź do źródłowych komunikatów.</p>
          <div className={styles.heroFooter}>
            <a href="#kalendarz" className={styles.heroPrimary}>Sprawdź kalendarz <span aria-hidden="true">↗</span></a>
            <span>Dane rynkowe · Dostęp bez logowania</span>
          </div>
        </div>
        <div className={styles.heroVisual} aria-hidden="true">
          <span className={styles.heroVisualTop}>MEXO <span> / MARKET INTELLIGENCE</span></span>
          <div className={styles.heroVisualCenter}>
            <div className={styles.visualMonth}>{month.label.toUpperCase()}</div>
            <div className={styles.visualBig}>{String(Number(month.key.slice(5))).padStart(2, "0")}<span>/{month.key.slice(0,4)}</span></div>
            <div className={styles.visualLine}><span /><span /><span /><span /><span /><span /><span /></div>
          </div>
          <span className={styles.heroVisualBottom}>01 / KALENDARZ GPW</span>
        </div>
      </section>

      <PublicCalendarSubscription />

      <section id="kalendarz" className={styles.calendarSection} aria-labelledby="calendar-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>KALENDARZ RYNKOWY</p><h2 id="calendar-title">Wydarzenia <span>GPW</span></h2></div>
          <p>Wydarzenia obecne w bazie Mexo. Kalendarz nie gwarantuje kompletności wszystkich ogłoszeń emitentów.</p>
        </div>

        <form className={styles.filters} action={PAGE_PATH} method="get" role="search">
          <input type="hidden" name="miesiac" value={month.key} />
          <label className={styles.filterField}><span>Spółka / ticker</span><input name="spolka" type="search" maxLength={64} defaultValue={company} placeholder="Np. Orlen, DNP..." autoComplete="off" /></label>
          <label className={styles.filterField}><span>Typ wydarzenia</span><select name="typ" defaultValue={category}>{DISPLAY_CATEGORY_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <button type="submit" className={styles.filterSubmit}>Filtruj <span aria-hidden="true">→</span></button>
          {company || category !== "all" ? <Link href={resetHref} className={styles.clearFilters}>Wyczyść</Link> : null}
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
                <Link aria-label="Poprzedni miesiąc" href={prevHref} className={styles.monthButton}>‹</Link>
                <Link href={PAGE_PATH} className={styles.todayButton}>Dziś</Link>
                <Link aria-label="Następny miesiąc" href={nextHref} className={styles.monthButton}>›</Link>
              </div>
            </div>
            <div className={styles.calendarGrid} aria-label={month.label}>
              {WEEKDAYS.map((weekday) => <div key={weekday} className={styles.weekday}>{weekday}</div>)}
              {calendarDays.map((day) => (
                <div aria-label={`${formatDate(day.date)}: ${day.events.length} wydarzeń`} key={day.date}
                  className={`${styles.calendarCell} ${!day.inMonth ? styles.outsideMonth : ""} ${day.date === month.todayKey ? styles.currentDay : ""}`}>
                  <span className={styles.dayNumber}>{day.day}</span>
                  {day.inMonth && day.events.length ? (
                    <a className={styles.dayEvents} href={`#dzien-${day.date}`} title={`${day.events.length} wydarzeń ${formatDate(day.date)}`} aria-label={`Przejdź do wydarzeń ${formatDate(day.date)}`}>
                      {day.events.slice(0, 3).map((event) => <span key={event.id} className={`${styles.eventDot} ${styles[`dot_${getGpwEventCategory(event.kind)}`]}`} />)}
                      <small>{day.events.length}</small>
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.legend}>
              <span><i className={styles.dot_reports} /> Raporty</span>
              <span><i className={styles.dot_meetings} /> WZA / NWZA</span>
              <span><i className={styles.dot_dividends} /> Dywidendy</span>
            </div>
            <p className={styles.calendarNote}>Daty prezentowane w polskiej strefie czasowej. Wydarzenie pojawia się dopiero po jego ogłoszeniu i wykryciu w źródłach.</p>
          </section>

          <section className={styles.agendaPanel} aria-labelledby="agenda-title">
            <div className={styles.agendaHeading}><div><p>HARMONOGRAM</p><h3 id="agenda-title">Najbliżej w miesiącu</h3></div><span>{events.length} pozycji</span></div>
            <div className={styles.agendaScroll}>
              {sourceUnavailable ? <div className={styles.empty}><strong>Źródło chwilowo niedostępne</strong><p>Nie udało się odczytać danych. To nie oznacza braku wydarzeń. Spróbuj ponownie za chwilę.</p></div> :
                eventDays.length === 0 ? <div className={styles.empty}><strong>Brak wydarzeń spełniających warunki</strong><p>Nie znaleźliśmy zweryfikowanych pozycji dla tego miesiąca i filtrów. Sprawdź inny miesiąc lub usuń filtry.</p></div> :
                eventDays.map((day) => (
                  <div className={styles.agendaDay} id={`dzien-${day.date}`} key={day.date}>
                    <div className={styles.agendaDate}><strong>{formatDate(day.date, { day: "2-digit" })}</strong><span>{formatDate(day.date, { weekday: "long", month: "long" })}</span></div>
                    <div className={styles.dayList}>{day.events.map((event) => <EventCard key={event.id} event={event} />)}</div>
                  </div>
                ))}
            </div>
          </section>
        </div>
        <div className={styles.dataDisclaimer}>
          <div><strong>Transparentność danych</strong><p>Terminy pochodzą z publicznych komunikatów spółek i źródeł giełdowych, do których prowadzą linki. To zestawienie pomocnicze: może nie obejmować wszystkich wydarzeń lub zmian.</p></div>
          <div className={styles.dataMeta}>{lastUpdated ? `Ostatnia zmiana zapisanych wydarzeń: ${formatPublishedAt(lastUpdated)}` : "Brak potwierdzonej daty aktualizacji"}{truncated ? <span>Wyniki częściowe — zawęź filtry.</span> : null}</div>
        </div>
      </section>

      <section className={styles.cta}>
        <div><p className={styles.kicker}>OD KALENDARZA DO PORTFELA</p><h2>Wydarzenia to kontekst.<br /><span>Twój portfel to całość.</span></h2><p>Śledź aktywa, transakcje, dywidendy i wyniki inwestycji w jednym miejscu. Zacznij korzystać z Mexo.</p></div>
        <Link href="/register" className={styles.ctaLink}>Załóż darmowe konto <span aria-hidden="true">↗</span></Link>
      </section>
      <footer className={styles.footer}><span>© Mexo · Kalendarz GPW</span><span>Informacje wyłącznie edukacyjne i informacyjne. Nie stanowią rekomendacji inwestycyjnej.</span></footer>
    </main>
  );
}
