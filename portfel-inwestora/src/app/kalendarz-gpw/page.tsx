import type { Metadata } from "next";
import Link from "next/link";
import {
  getCalendarMonth,
  normalizeCompanySearch,
  parseCalendarCategory,
  type PublicGpwCalendarEvent,
} from "@/lib/public-gpw-calendar";
import { getPublicGpwCalendarMonth } from "@/lib/server/public-gpw-calendar";
import {
  getGlobalDividendSourceState,
  getGlobalGeneralMeetingSourceState,
  getGlobalReportScheduleSourceState,
} from "@/lib/server/corporate-events";
import { queuePublicGpwCalendarSync } from "@/lib/server/public-gpw-sync";
import PublicCalendarClient from "./PublicCalendarClient";
import styles from "./page.module.css";

const SITE_URL = "https://mexo.com.pl";
const PAGE_PATH = "/kalendarz-gpw";

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

const formatPublishedAt = (date: string) => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? "nieznana" :
    new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" }).format(parsed);
};

type PageProps = {
  searchParams: Promise<{ miesiac?: string | string[]; typ?: string | string[]; spolka?: string | string[] }>;
};
const pickFirst = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function PublicGpwCalendarPage({ searchParams }: PageProps) {
  queuePublicGpwCalendarSync();
  const params = await searchParams;
  const month = getCalendarMonth(pickFirst(params.miesiac));
  const category = parseCalendarCategory(pickFirst(params.typ));
  const company = normalizeCompanySearch(pickFirst(params.spolka));

  let events: PublicGpwCalendarEvent[] = [];
  let lastUpdated: string | undefined;
  let truncated = false;
  let sourceUnavailable = false;
  let coverageNotice: string | null = null;
  try {
    const result = await getPublicGpwCalendarMonth(month.start, month.end, category, company);
    events = result.events;
    lastUpdated = result.latestRecordUpdatedAt;
    truncated = result.truncated;
    try {
      const sourceStates = await Promise.all([
        getGlobalReportScheduleSourceState(),
        getGlobalGeneralMeetingSourceState(),
        getGlobalDividendSourceState(),
      ]);
      if (sourceStates.some((state) => !state.backfillComplete)) {
        coverageNotice = "Uzupełniamy archiwum oficjalnych ogłoszeń. Kalendarz może jeszcze nie zawierać wszystkich terminów.";
      } else if (sourceStates.some((state) => state.status !== "SUCCESS")) {
        coverageNotice = "Co najmniej jedno źródło jest chwilowo niedostępne. Pokazujemy ostatnie zapisane wydarzenia.";
      }
    } catch {
      coverageNotice = "Nie można teraz potwierdzić kompletności danych. Pokazujemy ostatnie zapisane wydarzenia.";
    }
  } catch (error) {
    sourceUnavailable = true;
    console.error("[public-gpw-calendar] unable to read public GPW events", error instanceof Error ? error.name : "unknown");
  }

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

      <section id="kalendarz" className={styles.calendarSection} aria-labelledby="calendar-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>KALENDARZ RYNKOWY</p><h2 id="calendar-title">Wydarzenia <span>GPW</span></h2></div>
          <p>Wydarzenia obecne w bazie Mexo. Kalendarz nie gwarantuje kompletności wszystkich ogłoszeń emitentów.</p>
        </div>

        <PublicCalendarClient key={`${month.key}:${category}:${company}`} month={month} category={category} company={company} events={events} sourceUnavailable={sourceUnavailable} />
        <div className={styles.dataDisclaimer}>
          <div><strong>Transparentność danych</strong><p>Terminy pochodzą z publicznych komunikatów spółek i źródeł giełdowych, do których prowadzą linki. To zestawienie pomocnicze: może nie obejmować wszystkich wydarzeń lub zmian.</p></div>
          <div className={styles.dataMeta}>{lastUpdated ? `Ostatnia zmiana zapisanych wydarzeń: ${formatPublishedAt(lastUpdated)}` : "Brak potwierdzonej daty aktualizacji"}{coverageNotice ? <span>{coverageNotice}</span> : null}{truncated ? <span>Wyniki częściowe — zawęź filtry.</span> : null}</div>
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
