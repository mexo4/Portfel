"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getUpcomingDividendRelevantDate,
  type CorporateEvent,
  type CorporateEventsResponse,
} from "@/lib/corporate-events";
import { fetchCorporateEvents } from "@/lib/api";
import { getGpwWatchlistCanonicalKey, type WatchlistItem } from "@/lib/watchlist";
import { formatCurrency, formatDate } from "@/lib/utils";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";

const getNextEvent = (events: CorporateEvent[], canonicalKey: string) =>
  events
    .filter(
      (event) =>
        event.eventType !== "UPCOMING_DIVIDEND" &&
        getGpwWatchlistCanonicalKey(event.ticker) === canonicalKey
    )
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate))[0];

const getNextDividend = (events: CorporateEvent[], canonicalKey: string) =>
  events
    .filter(
      (event) =>
        event.eventType === "UPCOMING_DIVIDEND" &&
        getGpwWatchlistCanonicalKey(event.ticker) === canonicalKey &&
        Boolean(getUpcomingDividendRelevantDate(event))
    )
    .sort((left, right) =>
      (getUpcomingDividendRelevantDate(left) ?? "").localeCompare(
        getUpcomingDividendRelevantDate(right) ?? ""
      )
    )[0];

export default function WatchlistWorkspace() {
  const workspace = usePortfolioWorkspace();
  const [corporateEvents, setCorporateEvents] = useState<CorporateEventsResponse | null>(null);
  const [isEventsLoading, setIsEventsLoading] = useState(true);
  const [isRemovingKey, setIsRemovingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetchCorporateEvents({ portfolioId: "all", days: 183, signal: controller.signal })
      .then((eventResponse) => {
        if (controller.signal.aborted) return;
        setCorporateEvents(eventResponse);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError("Nie udało się pobrać obserwowanych spółek. Spróbuj ponownie później.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsEventsLoading(false);
      });

    return () => controller.abort();
  }, []);

  const quotesByKey = useMemo(() => {
    const quotes = new Map<string, { price: number; currency: string; fetchedAt?: string }>();
    workspace.portfolios.flatMap((portfolio) => portfolio.assets).forEach((asset) => {
      const key = getGpwWatchlistCanonicalKey(asset.symbol);
      if (!key || asset.kind !== "stock" || asset.marketCurrency !== "PLN") return;
      if (typeof asset.latestPrice !== "number" || asset.latestPrice <= 0) return;
      const current = quotes.get(key);
      const currentTime = Date.parse(current?.fetchedAt ?? "") || 0;
      const nextTime = Date.parse(asset.latestPriceFetchedAt ?? asset.lastUpdatedAt ?? "") || 0;
      if (!current || nextTime >= currentTime) {
        quotes.set(key, {
          price: asset.latestPrice,
          currency: asset.marketCurrency,
          fetchedAt: asset.latestPriceFetchedAt ?? asset.lastUpdatedAt,
        });
      }
    });
    return quotes;
  }, [workspace.portfolios]);

  const handleRemove = async (item: WatchlistItem) => {
    if (isRemovingKey) return;
    setIsRemovingKey(item.canonicalKey);
    setError(null);
    try {
      await workspace.onRemoveWatchlistItem(item.canonicalKey);
    } catch {
      setError("Nie udało się usunąć spółki z obserwowanych.");
    } finally {
      setIsRemovingKey(null);
    }
  };
  const items = workspace.watchlistItems;
  const isLoading = workspace.isWatchlistLoading || isEventsLoading;
  const displayedError = error ?? (workspace.watchlistReadError
    ? "Nie udało się pobrać obserwowanych spółek. Spróbuj ponownie później."
    : null);

  return (
    <div className="workspace-page watchlist-workspace">
      <section className="panel watchlist-intro">
        <p className="eyebrow">Rynek</p>
        <h2 className="section-title">Obserwowane</h2>
        <p className="section-copy">
          Spółki pozostają w kalendarzu GPW i nadchodzących dywidendach także bez pozycji w portfelu.
        </p>
      </section>

      {isLoading ? <p className="corporate-events-state">Wczytywanie obserwowanych spółek…</p> : null}
      {displayedError ? <p className="field-note field-note-error">{displayedError}</p> : null}

      {!isLoading && !displayedError && items.length === 0 ? (
        <section className="panel watchlist-empty-state">
          <p className="eyebrow">Lista jest pusta</p>
          <h2 className="section-title">Dodaj spółkę z wyszukiwarki instrumentów</h2>
          <p className="section-copy">
            Przy polskiej spółce GPW użyj gwiazdki, aby śledzić jej raporty i dywidendy bez kupowania akcji.
          </p>
          <Link href={workspace.getReadHref("/market/instruments")} className="ghost-button watchlist-search-link">
            Przejdź do wyszukiwarki instrumentów
          </Link>
        </section>
      ) : null}

      {items.length ? (
        <div className="watchlist-list" aria-label="Obserwowane spółki">
          {items.map((item) => {
            const quote = quotesByKey.get(item.canonicalKey);
            const nextEvent = getNextEvent(corporateEvents?.events ?? [], item.canonicalKey);
            const nextDividend = getNextDividend(corporateEvents?.events ?? [], item.canonicalKey);

            return (
              <article className="watchlist-row" key={item.id}>
                <div className="watchlist-company">
                  <strong>{item.name}</strong>
                  <span>{item.symbol}</span>
                </div>
                <div className="watchlist-quote">
                  <span>Kurs</span>
                  <strong>{quote ? formatCurrency(quote.price, quote.currency) : "Przy kolejnym odświeżeniu"}</strong>
                </div>
                <div className="watchlist-event">
                  <span>Następne wydarzenie</span>
                  {nextEvent ? <strong>{formatDate(nextEvent.eventDate)} · {nextEvent.fiscalPeriod ?? "raport"}</strong> : <strong>Brak potwierdzonego terminu</strong>}
                </div>
                <div className="watchlist-dividend">
                  <span>Nadchodząca dywidenda</span>
                  {nextDividend ? (
                    <strong>
                      {formatCurrency(nextDividend.dividendPerShare ?? 0, nextDividend.dividendCurrency ?? "PLN")} / akcję
                      {getUpcomingDividendRelevantDate(nextDividend) ? ` · ${formatDate(getUpcomingDividendRelevantDate(nextDividend)!)}` : ""}
                    </strong>
                  ) : <strong>Brak potwierdzonej dywidendy</strong>}
                </div>
                <button
                  type="button"
                  className="watchlist-remove"
                  onClick={() => { void handleRemove(item); }}
                  disabled={isRemovingKey === item.canonicalKey}
                  aria-label={`Usuń ${item.name} z obserwowanych`}
                >
                  <span aria-hidden="true">★</span>
                  {isRemovingKey === item.canonicalKey ? "Usuwanie…" : "Obserwowane"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
