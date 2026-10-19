"use client";

import { useState } from "react";
import { ICAL_CATEGORIES, getIcalSubscriptionUrl, type IcalCategory } from "@/lib/gpw-ical";
import styles from "./PublicCalendarSubscription.module.css";

const LABELS: Record<IcalCategory, string> = {
  reports: "Raporty okresowe", dividends: "Dzień dywidendy i wypłaty", meetings: "Walne zgromadzenia",
};

export default function PublicCalendarSubscription() {
  const [selected, setSelected] = useState<IcalCategory[]>([...ICAL_CATEGORIES]);
  const [message, setMessage] = useState("");
  const url = selected.length ? getIcalSubscriptionUrl(selected) : "";
  const webcal = url.replace(/^https:/, "webcal:");

  const toggle = (category: IcalCategory) => {
    setSelected((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : ICAL_CATEGORIES.filter((value) => current.includes(value) || value === category));
    setMessage("");
  };
  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Skopiowano adres. Wklej go jako subskrypcję kalendarza z internetu.");
    } catch {
      setMessage("Kopiowanie jest zablokowane przez przeglądarkę. Zaznacz i skopiuj adres poniżej.");
    }
  };

  return (
    <section className={styles.root} aria-labelledby="mexo-calendar-sub-title">
      <div className={styles.head}>
        <div>
          <p className={styles.eyebrow}>SUBSKRYPCJA ICALENDAR</p>
          <h2 id="mexo-calendar-sub-title">Wydarzenia GPW w Twoim kalendarzu</h2>
          <p>Wybierz kategorie. Apple Calendar, Google Calendar i Outlook mogą automatycznie odświeżać zapisane terminy.</p>
        </div>
      </div>
      <div className={styles.choices} role="group" aria-label="Kategorie wydarzeń GPW">
        {ICAL_CATEGORIES.map((category) => (
          <label className={styles.choice} key={category}>
            <input type="checkbox" checked={selected.includes(category)} onChange={() => toggle(category)} />
            <span>{LABELS[category]}</span>
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!url} onClick={copyUrl}>Kopiuj link subskrypcji</button>
        {url ? <a href={webcal} className={styles.secondary}>Otwórz w Apple Calendar</a> : null}
      </div>
      <label className={styles.urlLabel} htmlFor="mexo-ical-address">Adres subskrypcji (HTTPS)</label>
      <input id="mexo-ical-address" className={styles.url} value={url} placeholder="Wybierz co najmniej jedną kategorię" readOnly onFocus={(event) => event.target.select()} />
      <p className={styles.message} role="status">{message}</p>
      <p className={styles.help}>
        <strong>Google Calendar:</strong> na komputerze → Inne kalendarze → + → Z adresu URL. {" "}
        <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener noreferrer">Otwórz Google Calendar ↗</a>
      </p>
      <p className={styles.help}>
        <strong>Outlook:</strong> Kalendarz → Dodaj kalendarz → Subskrybuj z sieci Web → wklej adres HTTPS.
      </p>
      <p className={styles.footnote}>Dodaj kalendarz <strong>przez subskrypcję adresu URL</strong>, a nie import jednego pliku .ics. Odświeżanie zależy od aplikacji kalendarza i może potrwać ponad dobę. Lista pokazuje wydarzenia już znane Mexo.</p>
    </section>
  );
}
