"use client";

import { useEffect, useId, useState } from "react";
import {
  ICAL_CATEGORIES,
  getIcalSubscriptionUrl,
  type IcalCategory,
} from "@/lib/gpw-ical";
import styles from "./PublicCalendarSubscription.module.css";
import SavedCalendarSubscriptions from "@/components/SavedCalendarSubscriptions";

const META: Record<IcalCategory, { title: string; description: string; css: string }> = {
  reports: { title: "Raporty okresowe", description: "Kwartalne, półroczne i roczne", css: "reports" },
  dividends: { title: "Dywidendy", description: "Dni dywidendy i wypłaty", css: "dividends" },
  meetings: { title: "Walne zgromadzenia", description: "ZWZ i NWZ", css: "meetings" },
};

type Issuer = { ticker: string; companyName: string };
type Props = { embedded?: boolean };

export default function PublicCalendarSubscription({ embedded = false }: Props) {
  const uid = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<IcalCategory[]>([...ICAL_CATEGORIES]);
  const [tickers, setTickers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Issuer[]>([]);
  const [searchError, setSearchError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (search.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/calendar/issuers?search=${encodeURIComponent(search.trim())}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Nie udało się pobrać spółek GPW.");
        const result = await response.json() as { issuers?: Issuer[] };
        if (!controller.signal.aborted) {
          setMatches((result.issuers ?? []).filter((issuer) => !tickers.includes(issuer.ticker)));
          setSearchError("");
        }
      } catch {
        if (!controller.signal.aborted) {
          setMatches([]);
          setSearchError("Nie można pobrać spółek. Spróbuj ponownie.");
        }
      }
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [search, tickers]);

  const url = selected.length ? getIcalSubscriptionUrl(selected, tickers) : "";
  const webcal = url.replace(/^https:/, "webcal:");
  const toggle = (category: IcalCategory) => {
    setSelected((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : ICAL_CATEGORIES.filter((value) => current.includes(value) || value === category));
    setMessage("");
  };
  const addTicker = (ticker: string) => {
    setTickers((prev) => prev.includes(ticker) || prev.length >= 30 ? prev : [...prev, ticker].sort());
    setSearch("");
    setMatches([]);
    setMessage("");
  };
  const copyLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Skopiowano adres subskrypcji. Dodaj go do kalendarza z adresu URL.");
    } catch {
      setMessage("Kopiowanie niedostępne. Zaznacz i skopiuj adres poniżej.");
    }
  };

  return (
    <>
    {embedded ? <SavedCalendarSubscriptions /> : null}
    <section className={`${styles.root} ${embedded ? styles.embedded : ""}`} aria-labelledby={`${uid}-title`}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>SUBSKRYPCJE ICALENDAR · GPW</p>
        <h2 id={`${uid}-title`}>Wydarzenia Mexo w Twoim kalendarzu</h2>
        <p>Wybierz typy wydarzeń i spółki. Subskrypcja odświeża się automatycznie w Apple Calendar, Google Calendar i Outlooku.</p>
      </div>

      <div className={styles.choices} role="group" aria-label="Kategorie wydarzeń">
        {ICAL_CATEGORIES.map((category) => (
          <label key={category} className={`${styles.choice} ${styles[META[category].css]}`}>
            <input type="checkbox" checked={selected.includes(category)} onChange={() => toggle(category)} />
            <span className={styles.dot} aria-hidden="true" />
            <span><strong>{META[category].title}</strong><small>{META[category].description}</small></span>
          </label>
        ))}
      </div>

      <div className={styles.issuerSection}>
        <div className={styles.fieldTitle}>
          <strong>Spółki</strong>
          <span>{tickers.length ? `Wybrano ${tickers.length} z 30 możliwych` : "Wszystkie spółki GPW"}</span>
        </div>
        {tickers.length > 0 ? (
          <div className={styles.chips} aria-label="Wybrane tickery">
            {tickers.map((ticker) => (
              <button key={ticker} type="button" className={styles.chip}
                onClick={() => setTickers((prev) => prev.filter((item) => item !== ticker))}
                aria-label={`Usuń ${ticker} z subskrypcji`}>{ticker} <span aria-hidden="true">×</span></button>
            ))}
            <button type="button" className={styles.clear} onClick={() => { setTickers([]); setMessage(""); }}>
              Przywróć wszystkie spółki
            </button>
          </div>
        ) : null}
        <div className={styles.searchWrap}>
          <label htmlFor={`${uid}-search`} className={styles.searchLabel}>Dodaj spółkę po nazwie lub tickerze</label>
          <input id={`${uid}-search`} className={styles.search} type="search" value={search}
            onChange={(event) => setSearch(event.target.value)} autoComplete="off" maxLength={70}
            disabled={tickers.length >= 30} placeholder="Np. Dino, Orlen, XTB…" />
          {search.trim().length >= 2 && matches.length > 0 ? (
            <ul className={styles.suggestions} aria-label="Wyniki wyszukiwania spółek">
              {matches.map((issuer) => (
                <li key={issuer.ticker}>
                  <button type="button" onClick={() => addTicker(issuer.ticker)}>
                    <strong>{issuer.ticker}</strong><span>{issuer.companyName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : search.trim().length >= 2 && !searchError ? <p className={styles.searchNote}>Brak wyników lub trwa wyszukiwanie.</p> : null}
          {search.trim().length >= 2 && searchError ? <p className={styles.searchError} role="alert">{searchError}</p> : null}
        </div>
        <p className={styles.privacy}>Puste zaznaczenie oznacza cały rynek. Lista wybranych tickerów jest zapisana w publicznym adresie URL — nie ujawniaj linku, jeśli traktujesz tę listę jako prywatną.</p>
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="button" disabled={!url} onClick={() => copyLink(url)}>Kopiuj wspólny kalendarz</button>
        {url ? <a className={styles.secondary} href={webcal}>Otwórz w Apple Calendar</a> : null}
      </div>
      <label className={styles.urlLabel} htmlFor={`${uid}-address`}>Adres subskrypcji (HTTPS)</label>
      <input id={`${uid}-address`} className={styles.url} value={url} readOnly onFocus={(event) => event.target.select()}
        placeholder="Wybierz co najmniej jedną kategorię" />
      {message ? <p className={styles.message} role="status">{message}</p> : null}

      <div className={styles.separate}>
        <h3>Oddzielne kalendarze — pewniejsze kolory</h3>
        <p>Subskrybuj każdy typ osobno i ustaw jego kolor w aplikacji kalendarza. Kolor pojedynczych wydarzeń ICS nie jest jednakowo obsługiwany przez wszystkich dostawców.</p>
        <div className={styles.separateList}>
          {ICAL_CATEGORIES.filter((category) => selected.includes(category)).map((category) => (
            <div key={category} className={styles.separateRow}>
              <span className={`${styles.dot} ${styles[`${category}Dot`]}`} aria-hidden="true" />
              <strong>{META[category].title}</strong>
              <button type="button" onClick={() => copyLink(getIcalSubscriptionUrl([category], tickers))}>Kopiuj link</button>
              <a href={getIcalSubscriptionUrl([category], tickers).replace(/^https:/, "webcal:")}>Apple</a>
            </div>
          ))}
        </div>
      </div>
      <p className={styles.help}><strong>Google Calendar:</strong> na komputerze → Inne kalendarze → + → Z adresu URL. <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener noreferrer">Otwórz Google Calendar ↗</a></p>
      <p className={styles.help}><strong>Outlook:</strong> Kalendarz → Dodaj kalendarz → Subskrybuj z sieci Web → wklej adres HTTPS.</p>
      <p className={styles.footnote}>Użyj subskrypcji URL, nie jednorazowego importu .ics. Aktualizacje zależą od aplikacji (czasami ponad dobę). W kalendarzu są wyłącznie wydarzenia rozpoznane przez Mexo.</p>
    </section>
    </>
  );
}
