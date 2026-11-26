"use client";

import { useSyncExternalStore } from "react";

/** Line or candles for instrument charts: one choice for every chart, kept in this browser. */
export type ChartStyle = "line" | "candle";

const STORAGE_KEY = "mexo.chart.style";
const CHANGE_EVENT = "mexo:chart-style";
let memoryStyle: ChartStyle | null = null;

const read = (): ChartStyle => {
  if (memoryStyle) return memoryStyle;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "candle" ? "candle" : "line";
  } catch {
    return "line";
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
};

export const setChartStyle = (style: ChartStyle) => {
  memoryStyle = style;
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // The choice is a convenience: without storage it lasts until the page is reloaded.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const useChartStyle = () => useSyncExternalStore<ChartStyle>(subscribe, read, () => "line");
