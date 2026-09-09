"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { fetchEspiFeed, refreshEspi } from "@/lib/api";
import {
  ESPI_CATEGORIES,
  ESPI_CATEGORY_LABELS,
  ESPI_REPORT_TYPES,
  ESPI_REPORT_TYPE_LABELS,
  type EspiMarket,
  type EspiFeedResponse,
  type EspiReportSummary,
  type EspiSourceStatus,
} from "@/lib/espi";

type FeedScope = "all" | "watchlist" | "portfolio";
type MarketScope = Exclude<EspiMarket, "UNKNOWN">;
type FilterState = {
  query: string;
  company: string;
  ticker: string;
  category: string;
  reportType: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: FilterState = {
  query: "",
  company: "",
  ticker: "",
  category: "",
  reportType: "",
  dateFrom: "",
  dateTo: "",
};

const SOURCE_FAILURES: EspiSourceStatus[] = [
  "ACCESS_DENIED",
  "TEMPORARILY_UNAVAILABLE",
  "PARSE_ERROR",
];

const warsawDay = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const formatPublication = (value: string) => {
  const date = new Date(value);
  const day = warsawDay(date);
  const today = warsawDay(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const time = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  if (day === today) return `Dzisiaj, ${time}`;
  if (day === warsawDay(yesterdayDate)) return `Wczoraj, ${time}`;
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const trackingLabel = (report: EspiReportSummary) => {
  if (report.trackingSource === "PORTFOLIO_AND_WATCHLIST") return "PORTFEL + OBSERWOWANE";
  if (report.trackingSource === "PORTFOLIO") return "PORTFEL";
  if (report.trackingSource === "WATCHLIST") return "OBSERWOWANE";
  return null;
};

const formatAttachmentsCount = (count: number) => {
  if (count === 1) return "1 załącznik";
  const lastTwo = count % 100;
  const last = count % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} załączniki`;
  }
  return `${count} załączników`;
};

function ReportCard({ report }: { report: EspiReportSummary }) {
  const workspace = usePortfolioWorkspace();
  const tracking = trackingLabel(report);
  const reportLabel = ESPI_REPORT_TYPE_LABELS[report.reportType];
  return (
    <article className="espi-report-card">
      <div className="espi-report-rail">
        <div>
          <strong>{report.issuerName}</strong>
          {report.ticker ? <span>{report.ticker}</span> : null}
        </div>
        <time dateTime={report.publishedAt}>{formatPublication(report.publishedAt)}</time>
      </div>
      <div className="espi-report-meta">
        <span>{reportLabel}{report.reportNumber ? ` ${report.reportNumber}` : ""}</span>
        {report.attachmentsCount > 0 ? (
          <>
            <span className="espi-report-meta-separator" aria-hidden="true">·</span>
            <span>{formatAttachmentsCount(report.attachmentsCount)}</span>
          </>
        ) : null}
      </div>
      <h2><Link href={workspace.getReadHref(`/market/espi/${report.id}`)}>{report.title}</Link></h2>
      {report.excerpt ? <p>{report.excerpt}</p> : null}
      <div className="espi-report-badges">
        <span className="espi-tracking-badge">{report.market === "NEWCONNECT" ? "NEWCONNECT" : "GPW"}</span>
        <span className={`espi-category-badge espi-category-badge--${report.category.toLowerCase()}`}>
          {ESPI_CATEGORY_LABELS[report.category]}
        </span>
        {tracking ? <span className="espi-tracking-badge">{tracking}</span> : null}
        {report.isCorrection ? <span className="espi-correction-badge">KOREKTA</span> : null}
      </div>
    </article>
  );
}

export default function EspiWorkspace() {
  const [market, setMarket] = useState<MarketScope>("GPW");
  const [scope, setScope] = useState<FeedScope>("all");
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [feed, setFeed] = useState<EspiFeedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [applicationError, setApplicationError] = useState<string | null>(null);
  const generation = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const requestIdentity = useMemo(() => JSON.stringify({ market, scope, filters }), [filters, market, scope]);

  const load = useCallback(async ({ cursor, append = false }: { cursor?: string; append?: boolean } = {}) => {
    const currentGeneration = ++generation.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    if (append) setIsLoadingMore(true);
    else {
      setIsLoading(true);
      setApplicationError(null);
    }
    try {
      const value = await fetchEspiFeed({
        scope,
        market,
        cursor,
        query: filters.query || undefined,
        company: filters.company || undefined,
        ticker: filters.ticker || undefined,
        category: filters.category || undefined,
        reportType: filters.reportType || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        signal: controller.signal,
      });
      if (generation.current !== currentGeneration) return;
      setFeed((current) => append && current
        ? { ...value, items: [...current.items, ...value.items] }
        : value);
    } catch (error) {
      if (!controller.signal.aborted && generation.current === currentGeneration) {
        setApplicationError(error instanceof Error ? error.message : "Nie udało się odczytać raportów ESPI.");
      }
    } finally {
      if (generation.current === currentGeneration) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [filters, market, scope]);

  useEffect(() => {
    void load();
  // requestIdentity represents the complete applied query and prevents
  // draft typing from issuing a database request on every key stroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestIdentity]);

  useEffect(() => () => requestController.current?.abort(), []);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setApplicationError(null);
    try {
      await refreshEspi(1);
      await load();
    } catch (error) {
      setApplicationError(error instanceof Error ? error.message : "Nie udało się odświeżyć źródła ESPI.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const hasFilters = Object.values(filters).some(Boolean);
  const sourceUnavailable = feed && SOURCE_FAILURES.includes(feed.sync.status as EspiSourceStatus);

  return (
    <div className="workspace-page espi-workspace">
      <section className="panel espi-feed-header">
        <div>
          <p className="eyebrow">Oficjalne informacje rynkowe · PAP / ESPI</p>
          <h2 className="section-title">Raporty ESPI</h2>
          <p className="section-copy">Bieżące i archiwalne komunikaty emitentów, zapisane raz i filtrowane według rynku, portfela oraz obserwowanych.</p>
        </div>
        <div className="espi-feed-header-actions">
          <div className="espi-scope-switch" role="group" aria-label="Rynek raportów ESPI">
            <button type="button" className={market === "GPW" ? "is-active" : ""} onClick={() => setMarket("GPW")}>GPW</button>
            <button type="button" className={market === "NEWCONNECT" ? "is-active" : ""} onClick={() => setMarket("NEWCONNECT")}>NewConnect</button>
          </div>
          <button type="button" className="ghost-button" onClick={() => void handleRefresh()} disabled={isRefreshing}>
            {isRefreshing ? "Odświeżanie…" : "Odśwież feed"}
          </button>
        </div>
      </section>

      <div className="espi-scope-switch espi-market-filter" role="group" aria-label="Zakres spółek">
        <button type="button" className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>Wszystkie</button>
        <button type="button" className={scope === "watchlist" ? "is-active" : ""} onClick={() => setScope("watchlist")}>Obserwowane</button>
        <button type="button" className={scope === "portfolio" ? "is-active" : ""} onClick={() => setScope("portfolio")}>W portfelu</button>
      </div>

      <form className="panel panel-compact espi-filter-panel" onSubmit={(event) => {
        event.preventDefault();
        setFilters(draftFilters);
      }}>
        <label className="espi-filter-search"><span>Szukaj w raportach</span><input value={draftFilters.query} onChange={(event) => setDraftFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Tytuł, treść, emitent…" /></label>
        <label><span>Spółka</span><input value={draftFilters.company} onChange={(event) => setDraftFilters((current) => ({ ...current, company: event.target.value }))} placeholder="np. CD Projekt" /></label>
        <label><span>Ticker</span><input value={draftFilters.ticker} onChange={(event) => setDraftFilters((current) => ({ ...current, ticker: event.target.value }))} placeholder="np. CDR" autoCapitalize="characters" /></label>
        <label><span>Kategoria</span><select value={draftFilters.category} onChange={(event) => setDraftFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Wszystkie</option>{ESPI_CATEGORIES.map((category) => <option value={category} key={category}>{ESPI_CATEGORY_LABELS[category]}</option>)}</select></label>
        <label><span>Typ raportu</span><select value={draftFilters.reportType} onChange={(event) => setDraftFilters((current) => ({ ...current, reportType: event.target.value }))}><option value="">Wszystkie</option>{ESPI_REPORT_TYPES.map((type) => <option value={type} key={type}>{ESPI_REPORT_TYPE_LABELS[type]}</option>)}</select></label>
        <label><span>Od</span><input type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
        <label><span>Do</span><input type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
        <div className="espi-filter-actions">
          <button type="submit" className="primary-button">Zastosuj</button>
          <button type="button" className="ghost-button" disabled={!hasFilters && !Object.values(draftFilters).some(Boolean)} onClick={() => { setDraftFilters(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); }}>Wyczyść</button>
        </div>
      </form>

      {sourceUnavailable ? <div className="espi-source-notice" role="status"><strong>Źródło ESPI jest chwilowo niedostępne.</strong><span>Pokazujemy ostatnie poprawnie zapisane raporty; istniejące dane nie zostały usunięte.</span></div> : null}
      {applicationError ? <div className="espi-error-state" role="alert"><strong>Błąd aplikacji</strong><span>{applicationError}</span><button type="button" className="ghost-button" onClick={() => void load()}>Spróbuj ponownie</button></div> : null}

      {isLoading && !feed ? <div className="espi-feed-loading" aria-label="Wczytywanie raportów ESPI">{Array.from({ length: 5 }, (_, index) => <div key={index} />)}</div> : null}
      {!isLoading && feed && feed.items.length === 0 && !applicationError ? (
        <section className="panel espi-empty-state">
          <p className="eyebrow">{sourceUnavailable ? "Źródło niedostępne" : "Brak wyników"}</p>
          <h2 className="section-title">{sourceUnavailable ? "Nie udało się jeszcze pobrać raportów." : scope === "all" ? "Brak raportów dla wybranych filtrów." : "Brak raportów dla wybranych spółek."}</h2>
          <p className="section-copy">{scope === "all" ? "Zmień zakres dat lub wyczyść filtry." : scope === "watchlist" ? "Dodaj spółkę do Obserwowanych, aby zobaczyć jej raporty." : "Pokazujemy spółki z otwartą pozycją we wszystkich realnych portfelach."}</p>
        </section>
      ) : null}
      {feed?.items.length ? <section className="espi-feed-list" aria-live="polite">{feed.items.map((report) => <ReportCard key={report.id} report={report} />)}</section> : null}
      {feed?.hasMore ? <div className="espi-load-more"><button type="button" className="ghost-button" disabled={isLoadingMore} onClick={() => void load({ cursor: feed.nextCursor, append: true })}>{isLoadingMore ? "Wczytywanie…" : "Pokaż starsze raporty"}</button></div> : null}
    </div>
  );
}
