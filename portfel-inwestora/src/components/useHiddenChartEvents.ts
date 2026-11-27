"use client";

import { useSyncExternalStore } from "react";
import type { ChartEvent } from "@/lib/chart-events";

/** Which event marks are switched off: one choice for every chart, kept in this browser. */
const STORAGE_KEY = "mexo.chart.hidden-events";
const CHANGE_EVENT = "mexo:chart-events";
let memory: string | null = null;

const read = () => {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
};

export const toggleChartEvents = (kind: ChartEvent["kind"]) => {
  const hidden = new Set(read().split(",").filter(Boolean));
  if (!hidden.delete(kind)) hidden.add(kind);
  memory = [...hidden].sort().join(",");
  try {
    window.localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    // The choice is a convenience: without storage it lasts until the page is reloaded.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

/** The hidden kinds as one string, e.g. "espi" or "dividend,espi". */
export const useHiddenChartEvents = () => useSyncExternalStore(subscribe, read, () => "");
