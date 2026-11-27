"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fetchListingVenues } from "@/lib/api";
import { attachListingVenues, getVenueLookupSymbol, isVenueId, type VenueId } from "@/lib/listing-venue";
import type { PortfolioAssetGroup } from "@/lib/portfolio-engine";

const STORAGE_KEY = "mexo.listing-venues.v1";
const BATCH = 100;
const NOTHING: Readonly<Record<string, VenueId>> = {};

const parseVenues = (value: unknown) => {
  const venues: Record<string, VenueId> = {};
  if (value && typeof value === "object") {
    for (const [symbol, venue] of Object.entries(value)) if (isVenueId(venue)) venues[symbol] = venue;
  }
  return venues;
};

// The last answers are kept in the browser, so sections do not rename themselves on every visit.
let stored: Readonly<Record<string, VenueId>> | null = null;
const readStored = () => {
  if (!stored) {
    try {
      stored = parseVenues(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"));
    } catch {
      stored = NOTHING;
    }
  }
  return stored;
};
const writeStored = (venues: Record<string, VenueId>) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), ...venues }));
  } catch {
    // Without storage the exchanges are asked for again on the next visit.
  }
};
const subscribe = () => () => {};

/** Holdings with the exchange of every ticker whose saved data does not name one. */
export function useListingVenues(groups: PortfolioAssetGroup[]) {
  const symbolsKey = useMemo(
    () => [...new Set(groups.flatMap((group) => (group.kind === "stock" ? getVenueLookupSymbol(group) ?? [] : [])))].sort().join(" "),
    [groups]
  );
  const remembered = useSyncExternalStore(subscribe, readStored, () => NOTHING);
  const [answered, setAnswered] = useState<Record<string, VenueId>>({});

  useEffect(() => {
    if (!symbolsKey) return;
    const controller = new AbortController();
    fetchListingVenues(symbolsKey.split(" ").slice(0, BATCH), controller.signal)
      .then((response) => {
        const venues = parseVenues(response.venues);
        writeStored(venues);
        setAnswered((current) => ({ ...current, ...venues }));
      })
      // The holdings then stay under "Akcje zagraniczne".
      .catch(() => {});
    return () => controller.abort();
  }, [symbolsKey]);

  return useMemo(() => attachListingVenues(groups, { ...remembered, ...answered }), [answered, groups, remembered]);
}
