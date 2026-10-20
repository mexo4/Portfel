"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  CALENDAR_SUBSCRIPTION_SCOPES,
  type CalendarSubscription,
  type CalendarSubscriptionPayload,
  type CalendarSubscriptionPortfolio,
  type CalendarSubscriptionScope,
} from "@/lib/calendar-subscriptions";
import { ICAL_CATEGORIES } from "@/lib/gpw-ical";
import styles from "./PublicCalendarSubscription.module.css";

type Issuer = { ticker: string; companyName: string };
type ResponseData = { subscriptions: CalendarSubscription[]; portfolios: CalendarSubscriptionPortfolio[] };

const SCOPES: Record<CalendarSubscriptionScope, { title: string; description: string }> = {
  ALL_GPW: { title: "Wszystkie spółki GPW", description: "Pełny publiczny rynek główny" },
  PORTFOLIO: { title: "Spółki z portfela", description: "Aktualnie posiadane akcje z wybranych portfeli" },
  WATCHLIST: { title: "Lista obserwowanych", description: "Spółki dodane do Obserwowanych" },
  PORTFOLIO_AND_WATCHLIST: { title: "Portfel + obserwowane", description: "Połączenie obu dynamicznych list bez duplikatów" },
  MANUAL: { title: "Wybrane ręcznie", description: "Stała, własna lista spółek" },
};

const EMPTY: CalendarSubscriptionPayload = {
  name: "Mój kalendarz GPW",
  scope: "PORTFOLIO_AND_WATCHLIST",
  categories: [...ICAL_CATEGORIES],
  portfolioIds: [],
  manualTickers: [],
};

const readJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Operacja nie powiodła się.");
  return body;
};

export default function SavedCalendarSubscriptions() {
  const uid = useId().replace(/:/g, "");
  const [data, setData] = useState<ResponseData>({ subscriptions: [], portfolios: [] });
  const [draft, setDraft] = useState<CalendarSubscriptionPayload>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Issuer[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const response = await readJson<ResponseData>("/api/calendar/subscriptions");
      setData(response);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Nie udało się pobrać subskrypcji.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void readJson<ResponseData>("/api/calendar/subscriptions", { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) { setData(response); setError(""); } })
      .catch((value: unknown) => {
        if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Nie udało się pobrać subskrypcji.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (draft.scope !== "MANUAL" || search.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await readJson<{ issuers?: Issuer[] }>(
          `/api/calendar/issuers?search=${encodeURIComponent(search.trim())}`,
          { signal: controller.signal },
        );
        setMatches((result.issuers ?? []).filter((issuer) => !draft.manualTickers.includes(issuer.ticker)));
      } catch (value) {
        if (!(value instanceof DOMException && value.name === "AbortError")) setMatches([]);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [draft.scope, draft.manualTickers, search]);

  const reset = () => {
    setDraft(EMPTY);
    setEditingId(null);
    setSearch("");
    setMatches([]);
  };
  const update = <K extends keyof CalendarSubscriptionPayload>(key: K, value: CalendarSubscriptionPayload[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const chosenAllPortfolios = draft.portfolioIds.length === 0;
  const scopeNeedsPortfolios = draft.scope === "PORTFOLIO" || draft.scope === "PORTFOLIO_AND_WATCHLIST";
  const selectedLabel = useMemo(() => {
    if (draft.scope === "ALL_GPW") return "cały rynek GPW";
    if (draft.scope === "WATCHLIST") return "aktualna watchlista";
    if (draft.scope === "MANUAL") return `${draft.manualTickers.length} spółek`;
    return chosenAllPortfolios ? "wszystkie portfele" : `${draft.portfolioIds.length} portfeli`;
  }, [chosenAllPortfolios, draft]);

  const save = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const url = editingId ? `/api/calendar/subscriptions/${editingId}` : "/api/calendar/subscriptions";
      await readJson(url, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      setMessage(editingId ? "Zapisano ustawienia. Adres kalendarza pozostał bez zmian." : "Utworzono prywatną subskrypcję.");
      reset();
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Nie udało się zapisać subskrypcji.");
    } finally { setBusy(false); }
  };

  const beginEdit = (item: CalendarSubscription) => {
    setEditingId(item.id);
    setDraft({ name: item.name, scope: item.scope, categories: item.categories, portfolioIds: item.portfolioIds, manualTickers: item.manualTickers });
    setMessage(""); setError("");
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setMessage("Skopiowano prywatny adres ICS."); }
    catch { setMessage("Nie udało się skopiować automatycznie. Zaznacz adres ręcznie."); }
  };

  const mutate = async (item: CalendarSubscription, action: "rotate" | "delete") => {
    if (action === "rotate" && !window.confirm("Stary link natychmiast przestanie działać. Wygenerować nowy?")) return;
    if (action === "delete" && !window.confirm("Usunąć subskrypcję i unieważnić jej link?")) return;
    setBusy(true); setError("");
    try {
      await readJson(`/api/calendar/subscriptions/${item.id}${action === "rotate" ? "/rotate" : ""}`, { method: action === "rotate" ? "POST" : "DELETE" });
      setMessage(action === "rotate" ? "Stary link unieważniono. Skopiuj nowy adres." : "Subskrypcję usunięto, a link unieważniono.");
      if (editingId === item.id) reset();
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "Operacja nie powiodła się."); }
    finally { setBusy(false); }
  };

  return (
    <section className={styles.saved} aria-labelledby={`${uid}-saved-title`}>
      <div className={styles.savedHead}>
        <div><p className={styles.eyebrow}>PRYWATNE · DYNAMICZNE</p><h3 id={`${uid}-saved-title`}>Twoje zapisane kalendarze</h3></div>
        <span>{data.subscriptions.length} zapisanych</span>
      </div>
      <p className={styles.savedIntro}>Link działa bez logowania, dlatego traktuj go jak hasło. Dynamiczny kalendarz aktualizuje skład przy kolejnych odświeżeniach Apple, Google lub Outlooka.</p>

      {loading ? <p className={styles.searchNote}>Pobieranie konfiguracji…</p> : null}
      {data.subscriptions.length ? <div className={styles.savedList}>{data.subscriptions.map((item) => (
        <article className={styles.savedCard} key={item.id}>
          <div><strong>{item.name}</strong><small>{SCOPES[item.scope].title} · {item.issuerCount} spółek · {item.categories.length} kategorii</small></div>
          <input aria-label={`Adres ICS: ${item.name}`} value={item.feedUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
          <div className={styles.savedActions}>
            <button type="button" onClick={() => void copy(item.feedUrl)}>Kopiuj link</button>
            <a href={item.feedUrl.replace(/^https:/, "webcal:")}>Apple</a>
            <button type="button" onClick={() => beginEdit(item)}>Edytuj</button>
            <button type="button" onClick={() => void mutate(item, "rotate")} disabled={busy}>Nowy link</button>
            <button type="button" className={styles.danger} onClick={() => void mutate(item, "delete")} disabled={busy}>Usuń</button>
          </div>
        </article>
      ))}</div> : !loading ? <p className={styles.searchNote}>Nie masz jeszcze zapisanej subskrypcji.</p> : null}

      <div className={styles.builder}>
        <div className={styles.builderHead}><h3>{editingId ? "Edytuj subskrypcję" : "Nowa subskrypcja"}</h3><span>{selectedLabel}</span></div>
        <label className={styles.formField}>Nazwa<input value={draft.name} maxLength={80} onChange={(event) => update("name", event.target.value)} /></label>
        <fieldset className={styles.scopeGrid}><legend>Źródło spółek</legend>{CALENDAR_SUBSCRIPTION_SCOPES.map((scope) => (
          <label key={scope} className={draft.scope === scope ? styles.isSelected : ""}>
            <input type="radio" name={`${uid}-scope`} checked={draft.scope === scope} onChange={() => update("scope", scope)} />
            <span><strong>{SCOPES[scope].title}</strong><small>{SCOPES[scope].description}</small></span>
          </label>
        ))}</fieldset>

        {scopeNeedsPortfolios ? <fieldset className={styles.portfolioGrid}><legend>Portfele</legend>
          <label><input type="checkbox" checked={chosenAllPortfolios} onChange={() => update("portfolioIds", [])} /> Wszystkie portfele</label>
          {data.portfolios.map((portfolio) => <label key={portfolio.id}><input type="checkbox" checked={draft.portfolioIds.includes(portfolio.id)} onChange={() => update("portfolioIds", draft.portfolioIds.includes(portfolio.id) ? draft.portfolioIds.filter((id) => id !== portfolio.id) : [...draft.portfolioIds, portfolio.id])} /> {portfolio.name}</label>)}
        </fieldset> : null}

        {draft.scope === "MANUAL" ? <div className={styles.manualPicker}>
          <div className={styles.chips}>{draft.manualTickers.map((ticker) => <button key={ticker} type="button" className={styles.chip} onClick={() => update("manualTickers", draft.manualTickers.filter((item) => item !== ticker))}>{ticker} <span aria-hidden="true">×</span></button>)}</div>
          <label className={styles.formField}>Dodaj spółkę<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nazwa lub ticker" /></label>
          {search.trim().length >= 2 && matches.length ? <ul className={styles.suggestions}>{matches.map((issuer) => <li key={issuer.ticker}><button type="button" onClick={() => { update("manualTickers", [...draft.manualTickers, issuer.ticker].sort()); setSearch(""); setMatches([]); }}><strong>{issuer.ticker}</strong><span>{issuer.companyName}</span></button></li>)}</ul> : null}
        </div> : null}

        <fieldset className={styles.categoryGrid}><legend>Kategorie</legend>{ICAL_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={draft.categories.includes(category)} onChange={() => update("categories", draft.categories.includes(category) ? draft.categories.filter((item) => item !== category) : ICAL_CATEGORIES.filter((item) => draft.categories.includes(item) || item === category))} /> {category === "reports" ? "Raporty" : category === "dividends" ? "Dywidendy" : "WZA"}</label>)}</fieldset>
        <div className={styles.builderActions}><button type="button" className={styles.primary} disabled={busy || !draft.name.trim() || draft.categories.length === 0 || (draft.scope === "MANUAL" && draft.manualTickers.length === 0)} onClick={() => void save()}>{busy ? "Zapisywanie…" : editingId ? "Zapisz bez zmiany linku" : "Utwórz subskrypcję"}</button>{editingId ? <button type="button" className={styles.secondary} onClick={reset}>Anuluj</button> : null}</div>
      </div>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {error ? <p className={styles.searchError} role="alert">{error}</p> : null}
      <p className={styles.footnote}><strong>Odświeżanie:</strong> Mexo udostępnia aktualny feed przy każdym pobraniu. Częstotliwość sprawdzania subskrypcji ustala Apple, Google lub Outlook i może wynosić od kilku godzin do ponad doby.</p>
    </section>
  );
}
