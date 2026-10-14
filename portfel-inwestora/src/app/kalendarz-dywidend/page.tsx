import type { Metadata } from "next";
import Link from "next/link";
import {
  getDividendDateKindLabel,
  getDividendHref,
  getDividendStatusLabel,
  getDividendWindow,
  getDividendYear,
  getWarsawDividendToday,
  matchesDividendStatus,
  normalizeDividendCompanySearch,
  parseDividendSort,
  parseDividendStatus,
  parseDividendView,
  sortPublicDividends,
  type DividendStatusFilter,
  type DividendView,
  type PublicDividend,
} from "@/lib/public-dividend-calendar";
import { getPublicDividendCalendar } from "@/lib/server/public-dividend-calendar";
import styles from "./page.module.css";

const ORIGIN = "https://mexo.com.pl";
const PATH = "/kalendarz-dywidend";

// Enable search indexing only when licensing, coverage and public data provenance
// have been reviewed. Filtered URLs should retain this canonical URL.
export const metadata: Metadata = {
  title: "Kalendarz dywidend GPW – dzień dywidendy i wypłaty | Mexo",
  description:
    "Kalendarz dywidend spółek GPW: kwoty na akcję, dni dywidendy, terminy wypłat i źródła oficjalnych komunikatów. Sprawdź nadchodzące i historyczne wydarzenia.",
  alternates: { canonical: `${ORIGIN}${PATH}` },
  robots: { index: process.env.MEXO_PUBLIC_DIVIDENDS_INDEXABLE === "true", follow: true },
  openGraph: {
    title: "Kalendarz dywidend GPW | Mexo",
    description: "Terminy i kwoty dywidend GPW, komunikaty spółek i wygodne filtry w jednym miejscu.",
    url: `${ORIGIN}${PATH}`,
    siteName: "Mexo",
    locale: "pl_PL",
    type: "website",
  },
};

const formatDate = (date: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
  new Intl.DateTimeFormat("pl-PL", { ...options, timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00.000Z`));

const formatTimestamp = (date: string | undefined) => {
  if (!date || Number.isNaN(Date.parse(date))) return "Nieustalona";
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric", month: "long", year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(date));
};

const formatAmount = (amount: number | undefined, currency: string) =>
  amount === undefined
    ? "Brak potwierdzonej kwoty"
    : `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)} ${currency === "—" ? "(waluta nieustalona)" : currency}`;

const VIEWS: { value: DividendView; title: string; subtitle: string }[] = [
  { value: "upcoming", title: "Nadchodzące", subtitle: "Dzień dywidendy lub wypłata w ciągu 12 miesięcy" },
  { value: "history", title: "Archiwum", subtitle: "Zdarzenia z ostatnich 12 miesięcy" },
  { value: "year", title: "Według roku", subtitle: "Przegląd wybranego roku kalendarzowego" },
];

const STATUS_OPTIONS: { value: DividendStatusFilter; label: string }[] = [
  { value: "all", label: "Wszystkie statusy" },
  { value: "confirmed", label: "Potwierdzone" },
  { value: "proposed", label: "Propozycje" },
  { value: "other", label: "Inne / zmienione" },
];

function Status({ dividend }: { dividend: PublicDividend }) {
  return (
    <span className={`${styles.status} ${styles[`status_${dividend.status}`]}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {getDividendStatusLabel(dividend.status)}
    </span>
  );
}

function SourceLink({ dividend }: { dividend: PublicDividend }) {
  return (
    <a className={styles.sourceLink} href={dividend.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
      Oficjalne źródło <span aria-hidden="true">↗</span>
    </a>
  );
}

function DividendTable({ dividends }: { dividends: PublicDividend[] }) {
  return (
    <>
      <div className={styles.tableScroll} role="region" aria-label="Zestawienie dywidend GPW" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Spółka</th>
              <th scope="col">Dywidenda / akcję</th>
              <th scope="col">Dzień dywidendy</th>
              <th scope="col">Wypłata</th>
              <th scope="col">Status</th>
              <th scope="col">Źródło</th>
            </tr>
          </thead>
          <tbody>
            {dividends.map((dividend) => (
              <tr key={dividend.id}>
                <td>
                  <div className={styles.companyName}>{dividend.companyName}</div>
                  <span className={styles.ticker}>{dividend.ticker}</span>
                  {dividend.installment ? <span className={styles.installment}>Transza {dividend.installment}</span> : null}
                </td>
                <td>
                  <strong className={styles.amount}>{formatAmount(dividend.amount, dividend.currency)}</strong>
                  {dividend.advancePerShare ? <span className={styles.detailLine}>W tym rozliczono zaliczkę: {formatAmount(dividend.advancePerShare, dividend.currency)}</span> : null}
                </td>
                <td className={styles.dateCell}>{dividend.recordDate ? formatDate(dividend.recordDate) : "—"}</td>
                <td className={styles.dateCell}>{dividend.paymentDate ? formatDate(dividend.paymentDate) : "—"}</td>
                <td><Status dividend={dividend} /></td>
                <td><SourceLink dividend={dividend} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.mobileRows}>
        {dividends.map((dividend) => (
          <article key={dividend.id} className={styles.mobileCard}>
            <div className={styles.mobileHeading}>
              <div>
                <strong>{dividend.companyName}</strong>
                <span>{dividend.ticker}{dividend.installment ? ` · transza ${dividend.installment}` : ""}</span>
              </div>
              <Status dividend={dividend} />
            </div>
            <p className={styles.mobileAmount}>{formatAmount(dividend.amount, dividend.currency)} <small>/ akcję</small></p>
            <dl className={styles.mobileDates}>
              <div><dt>Dzień dywidendy</dt><dd>{dividend.recordDate ? formatDate(dividend.recordDate) : "—"}</dd></div>
              <div><dt>Wypłata</dt><dd>{dividend.paymentDate ? formatDate(dividend.paymentDate) : "—"}</dd></div>
            </dl>
            <div className={styles.mobileSource}><SourceLink dividend={dividend} /></div>
          </article>
        ))}
      </div>
    </>
  );
}

type PageProps = {
  searchParams: Promise<{
    widok?: string | string[];
    rok?: string | string[];
    spolka?: string | string[];
    status?: string | string[];
    sortowanie?: string | string[];
  }>;
};

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function PublicDividendCalendarPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const today = getWarsawDividendToday();
  const view = parseDividendView(first(params.widok));
  const year = getDividendYear(first(params.rok), today);
  const company = normalizeDividendCompanySearch(first(params.spolka));
  const status = parseDividendStatus(first(params.status));
  const sort = parseDividendSort(first(params.sortowanie));
  const window = getDividendWindow(view, year, today);

  let items: PublicDividend[] = [];
  let lastChanged: string | undefined;
  let unavailable = false;
  let truncated = false;
  try {
    const result = await getPublicDividendCalendar(window.from, window.to, company, view);
    items = result.dividends;
    truncated = result.truncated;
    lastChanged = result.latestRecordUpdatedAt;
  } catch (error) {
    unavailable = true;
    console.error("[public-dividend-calendar] unable to read source events", error instanceof Error ? error.name : "unknown");
  }

  const visible = sortPublicDividends(items.filter((item) => matchesDividendStatus(item, status)), sort, view);
  const companies = new Set(visible.map((item) => item.ticker.toUpperCase())).size;
  const confirmed = visible.filter((item) => item.status === "CONFIRMED").length;
  const payouts = visible.filter((item) => item.paymentDate && item.paymentDate >= window.from && item.paymentDate <= window.to).length;
  const showcase = sortPublicDividends(
    items.filter((item) => item.status === "CONFIRMED"),
    "date", view
  ).slice(0, 3);
  const currentYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 13 }, (_, index) => currentYear + 2 - index);
  const activeView = VIEWS.find((item) => item.value === view) ?? VIEWS[0]!;

  return (
    <main className="marketing-shell">
      <nav className="marketing-nav" aria-label="Nawigacja Mexo">
        <Link href="/" className="brand-link">Mexo<span className={styles.brandDot}>.</span></Link>
        <div className="marketing-nav-actions">
          <Link href="/kalendarz-gpw" className={styles.navSecondary}>Kalendarz GPW</Link>
          <Link href="/narzedzia/procent-skladany" className={styles.navSecondary}>Narzędzia</Link>
          <Link href="/pricing" className={styles.navSecondary}>Cennik</Link>
          <Link href="/register" className="primary-button">Załóż konto</Link>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <p className={styles.eyebrow}><span aria-hidden="true" className={styles.liveDot} /> DANE RYNKOWE · GŁÓWNY RYNEK GPW</p>
          <h1>Dywidendy bez <span>szukania.</span></h1>
          <p className={styles.lead}>
            Sprawdzaj dni dywidendy, terminy wypłat i kwoty na akcję w jednym miejscu.
            Każdy wpis prowadzi do oryginalnego komunikatu spółki.
          </p>
          <div className={styles.heroActions}>
            <a href="#dywidendy" className={styles.primaryAction}>Przeglądaj kalendarz <span aria-hidden="true">↘</span></a>
            <Link href="/kalendarz-gpw" className={styles.secondaryAction}>Pozostałe wydarzenia GPW ↗</Link>
          </div>
          <p className={styles.heroFootnote}>Bez logowania · bez płatnych danych w czasie rzeczywistym · aktualizowane z zapisanych komunikatów</p>
        </div>
        <aside className={styles.heroAside} aria-label="Potwierdzone dywidendy z zapisanych komunikatów">
          <div className={styles.asideHeader}>
            <span>TERMINARZ / GPW</span><span className={styles.asideSymbol}>↗</span>
          </div>
          <div className={styles.asideTitle}>Wybrane terminy</div>
          <div className={styles.asideList}>
            {showcase.length > 0 ? showcase.map((item, index) => (
              <div key={item.id} className={styles.asideRow}>
                <span className={styles.asideNumber}>0{index + 1}</span>
                <div className={styles.asideItem}>
                  <strong>{item.companyName}</strong>
                  <small>{getDividendDateKindLabel(item.displayDateKind)}</small>
                </div>
                <time dateTime={item.displayDate} className={styles.asideDate}>
                  {formatDate(item.displayDate, { day: "2-digit", month: "2-digit" })}
                </time>
              </div>
            )) : <p className={styles.asideEmpty}>Brak potwierdzonych terminów w wybranym zakresie. Nie prognozujemy dat.</p>}
          </div>
          <div className={styles.asideFooter}>DYWIDENDY <span>{view === "year" ? String(year) : "GPW"}</span></div>
        </aside>
      </section>

      <section id="dywidendy" className={styles.calendarSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>KALENDARZ DYWIDEND</p>
            <h2>Terminy i kwoty<span>.</span></h2>
          </div>
          <p>Różne etapy procesu dywidendowego są oznaczone osobno. Propozycja zarządu nie jest jeszcze uchwałą o wypłacie.</p>
        </div>

        <div className={styles.tabs} aria-label="Zakres kalendarza">
          {VIEWS.map((item) => (
            <Link key={item.value} aria-current={view === item.value ? "page" : undefined}
              className={`${styles.tab} ${view === item.value ? styles.tabActive : ""}`}
              href={getDividendHref({ view: item.value, status, sort, company, year })}>
              {item.title}
            </Link>
          ))}
        </div>
        <div className={styles.rangeDescription}>
          <span>{activeView.subtitle}</span>
          <span><strong>{formatDate(window.from)}</strong> — <strong>{formatDate(window.to)}</strong></span>
        </div>

        <form className={styles.filters} action={PATH} method="GET" role="search" aria-label="Filtruj dywidendy">
          {view !== "upcoming" ? <input type="hidden" name="widok" value={view} /> : null}
          <label className={`${styles.field} ${styles.searchField}`}>
            <span>Spółka lub ticker</span>
            <input name="spolka" type="search" defaultValue={company} maxLength={70} placeholder="Np. Dino, Orlen, XTB..." />
          </label>
          {view === "year" ? (
            <label className={styles.field}>
              <span>Rok</span>
              <select name="rok" defaultValue={year}>
                {years.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ) : null}
          <label className={styles.field}>
            <span>Status</span>
            <select name="status" defaultValue={status}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Sortuj według</span>
            <select name="sortowanie" defaultValue={sort}>
              <option value="date">Terminu</option>
              <option value="amount">Kwoty / akcję</option>
              <option value="company">Nazwy spółki</option>
            </select>
          </label>
          <button type="submit" className={styles.filterSubmit}>Pokaż wyniki <span aria-hidden="true">→</span></button>
          {(company || status !== "all" || sort !== "date") ? (
            <Link href={getDividendHref({ view, year })} className={styles.resetLink}>Wyczyść</Link>
          ) : null}
        </form>

        <div className={styles.metrics}>
          <div><span>ZDARZENIA W WYNIKACH</span><strong>{visible.length}{truncated ? "+" : ""}</strong></div>
          <div><span>SPÓŁKI</span><strong>{companies}</strong></div>
          <div><span>POTWIERDZONE</span><strong>{confirmed}</strong></div>
          <div><span>TERMINY WYPŁAT</span><strong>{payouts}</strong></div>
        </div>

        <div className={styles.resultsPanel}>
          <div className={styles.resultsHeader}>
            <div>
              <p className={styles.kicker}>ZAPISANE KOMUNIKATY</p>
              <h3>{window.title}</h3>
            </div>
            <span className={styles.resultsCount}>{visible.length} wpisów</span>
          </div>
          {unavailable ? (
            <div className={styles.empty} role="status">
              <strong>Nie udało się pobrać kalendarza.</strong>
              <p>Źródłowa baza danych jest chwilowo niedostępna. Nie pokazujemy przykładowych lub wymyślonych dywidend.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.empty} role="status">
              <strong>Brak zapisanych dywidend dla wybranych filtrów.</strong>
              <p>Nie oznacza to, że żadna spółka nie wypłaci dywidendy. Nie wszystkie przyszłe decyzje zostały ogłoszone i przetworzone.</p>
              <Link href={getDividendHref({ view, year })}>Zresetuj filtry →</Link>
            </div>
          ) : <DividendTable dividends={visible} />}
          {truncated ? <p className={styles.truncatedNote}>Zestawienie przekracza limit odczytu. Lista może być niepełna — użyj wyszukiwania spółki lub węższego okresu.</p> : null}
        </div>

        <div className={styles.explainer}>
          <div>
            <p className={styles.kicker}>JAK TO CZYTAĆ?</p>
            <h2>Trzy daty, które <span>warto rozróżniać.</span></h2>
          </div>
          <div className={styles.explainerList}>
            <div><span>01</span><div><h3>Dzień dywidendy</h3><p>Data ustalenia prawa do dywidendy. Samo posiadanie akcji w dniu wypłaty nie wystarcza, aby ją otrzymać.</p></div></div>
            <div><span>02</span><div><h3>Ex-dividend</h3><p>Data, od której zakup akcji co do zasady nie daje prawa do najbliższej dywidendy. Zwykle przypada przed dniem dywidendy.</p></div></div>
            <div><span>03</span><div><h3>Termin wypłaty</h3><p>Dzień, na który spółka zapowiedziała wypłatę. Pieniądze mogą zostać zaksięgowane na rachunku brokera później.</p></div></div>
          </div>
        </div>

        <div className={styles.dataNotice}>
          <div>
            <strong>Dane mają charakter informacyjny.</strong>
            <p>Kalendarz obejmuje rozpoznane wydarzenia z zapisanych komunikatów dotyczących głównego rynku GPW, nie kompletną historię wszystkich dywidend. Terminy i kwoty mogą ulegać zmianom; potwierdzaj je w oficjalnym źródle. Nie jest to rekomendacja inwestycyjna.</p>
          </div>
          <div className={styles.updateMeta}>
            <span>Ostatnia zmiana widocznych danych źródłowych</span>
            <strong>{formatTimestamp(lastChanged)}</strong>
            <small>Nie jest to czas ostatniej udanej synchronizacji całego rynku.</small>
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <div>
          <p className={styles.ctaKicker}>OD KALENDARZA DO PORTFELA</p>
          <h2>Terminy to jedno. <span>Cały portfel to Mexo.</span></h2>
          <p>Śledź akcje, ETF-y, transakcje i wyniki inwestycji w jednym miejscu. Kalendarz jest dostępny bez konta — do zarządzania portfelem załóż darmowe konto.</p>
        </div>
        <Link href="/register" className={styles.ctaLink}>Załóż darmowe konto <span aria-hidden="true">↗</span></Link>
      </section>

      <footer className={styles.footer}>
        <span>© Mexo · narzędzia dla inwestora</span>
        <span><Link href="/kalendarz-gpw">Kalendarz GPW</Link> · <Link href="/narzedzia/procent-skladany">Procent składany</Link> · <Link href="/pricing">Cennik</Link></span>
      </footer>
    </main>
  );
}
