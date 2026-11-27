"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchEspiFeed } from "@/lib/api";
import { collectEspiHistory, ESPI_CHART_PAGE_SIZE, type ChartAnnouncement, type EspiHistory } from "@/lib/chart-events";

export type ChartAnnouncements = {
  /** "off": not a company listed in Warsaw, or no access to ESPI. */
  status: "off" | "loading" | "ready" | "error";
  items: ChartAnnouncement[];
  isCut: boolean;
};

const cache = new Map<string, Promise<EspiHistory>>();

/** One set of requests per company and start date, shared by every chart until the page reloads. */
const loadReports = (ticker: string, dateFrom: string) => {
  const key = `${ticker}|${dateFrom}`;
  const cached = cache.get(key);
  if (cached) return cached;
  // "all", because a company sold in full is neither held nor watched any more.
  const request = collectEspiHistory(({ market, cursor }) => fetchEspiFeed({ scope: "all", market, ticker, dateFrom, cursor, limit: ESPI_CHART_PAGE_SIZE }));
  request.catch(() => cache.delete(key));
  cache.set(key, request);
  return request;
};

const NONE: ChartAnnouncement[] = [];

/** The ESPI reports of one company since `dateFrom`. A `null` ticker asks for nothing. */
export function useChartAnnouncements(ticker: string | null, dateFrom: string): ChartAnnouncements {
  const requestKey = ticker ? `${ticker}|${dateFrom}` : "";
  const [state, setState] = useState<{ key: string; value: ChartAnnouncements } | null>(null);

  useEffect(() => {
    if (!ticker) return;
    const key = `${ticker}|${dateFrom}`;
    let cancelled = false;
    loadReports(ticker, dateFrom)
      .then((history) => { if (!cancelled) setState({ key, value: { status: "ready", items: history.items, isCut: history.isCut } }); })
      .catch((error: unknown) => {
        const isDenied = error instanceof ApiError && (error.status === 401 || error.status === 403);
        if (!cancelled) setState({ key, value: { status: isDenied ? "off" : "error", items: NONE, isCut: false } });
      });
    return () => { cancelled = true; };
  }, [dateFrom, ticker]);

  if (!ticker) return { status: "off", items: NONE, isCut: false };
  return state && state.key === requestKey ? state.value : { status: "loading", items: NONE, isCut: false };
}
