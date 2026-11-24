import {
  deleteMarketCachePayload,
  getMarketCacheEntry,
  setMarketCachePayloadIfNewer,
} from "@/lib/server/market-cache";
import {
  normalizeIssuerIsin,
  parseGleifIssuerCountry,
  type IssuerCountryInstrumentIdentity,
  type IssuerCountryResolution,
} from "@/lib/issuer-country";
import { resolveEodhdCommonStockIsin } from "@/lib/server/eodhd";
import { createTtlMemo } from "@/lib/server/ttl-memo";

const GLEIF_API_URL = "https://api.gleif.org/api/v1/lei-records";
const CONFIRMED_TTL_MS = 1000 * 60 * 60 * 24 * 180;
const UNRESOLVED_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const inFlightByIsin = new Map<string, Promise<IssuerCountryResolution | null>>();
const generationByIsin = new Map<string, number>();
// Every workspace page and portfolio API enriches the whole book, and an issuer without a stored
// country was looked up again each time: one or two reads of the shared cache per issuer, about
// 350 ms per request for a 30-instrument portfolio. The outcome (a country or none) is reused for
// a few minutes; the database cache underneath keeps its own, much longer, lifetimes.
const RESOLUTION_MEMO_TTL_MS = 1000 * 60 * 5;
const resolutionMemo = createTtlMemo<IssuerCountryResolution | null>({
  ttlMs: RESOLUTION_MEMO_TTL_MS,
  maxEntries: 2_000,
});

type CachedIssuerCountry =
  | {
      version: 1;
      status: "confirmed";
      country: string;
      source: "gleif-isin";
      lei: string;
    }
  | { version: 1; status: "no-match" | "ambiguous" };

const cacheKeyForIsin = (isin: string) => `issuer-country:gleif:isin:${isin}`;

const isCachedIssuerCountry = (value: unknown): value is CachedIssuerCountry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && (
    candidate.status === "no-match" ||
    candidate.status === "ambiguous" ||
    (candidate.status === "confirmed" &&
      typeof candidate.country === "string" && /^[A-Z]{2}$/.test(candidate.country) &&
      candidate.source === "gleif-isin" && typeof candidate.lei === "string")
  );
};

const toResolution = (
  value: CachedIssuerCountry | null,
  isin: string
): IssuerCountryResolution | null =>
  value?.status === "confirmed"
    ? { country: value.country, source: value.source, lei: value.lei, isin }
    : null;

const fetchGleifIssuerCountry = async (
  isin: string,
  canCommit: () => boolean,
  preserveConfirmed: boolean
) => {
  const url = new URL(GLEIF_API_URL);
  url.searchParams.set("filter[isin]", isin);
  url.searchParams.set("page[size]", "10");
  const requestStartedAt = new Date().toISOString();

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/vnd.api+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(3500),
  });

  if (!response.ok) return null;

  const payload: unknown = await response.json();
  const resolution = parseGleifIssuerCountry(payload, isin);
  const data = payload && typeof payload === "object"
    ? (payload as { data?: unknown }).data
    : undefined;

  if (resolution) {
    const cache: CachedIssuerCountry = {
      version: 1,
      status: "confirmed",
      country: resolution.country,
      source: resolution.source,
      lei: resolution.lei,
    };
    if (canCommit()) {
      try {
        await setMarketCachePayloadIfNewer(cacheKeyForIsin(isin), cache, requestStartedAt);
      } catch {
        // A cache write failure must not discard a valid public-source response.
      }
    }
    return resolution;
  }

  if (Array.isArray(data) && !preserveConfirmed) {
    const cache: CachedIssuerCountry = {
      version: 1,
      status: data.length === 0 ? "no-match" : "ambiguous",
    };
    if (canCommit()) {
      try {
        await setMarketCachePayloadIfNewer(cacheKeyForIsin(isin), cache, requestStartedAt);
      } catch {
        // A cache write failure must not make a successful negative lookup fatal.
      }
    }
    return null;
  }

  return null;
};

const resolveUncached = async (
  isin: string,
  generation: number
): Promise<IssuerCountryResolution | null> => {
  const key = cacheKeyForIsin(isin);
  let fresh: CachedIssuerCountry | null = null;
  let stale: CachedIssuerCountry | null = null;

  try {
    const entry = await getMarketCacheEntry(key);
    if (entry && isCachedIssuerCountry(entry.payload)) {
      stale = entry.payload;
      const ageMs = Date.now() - Date.parse(entry.updatedAt);
      const ttlMs = stale.status === "confirmed" ? CONFIRMED_TTL_MS : UNRESOLVED_TTL_MS;
      if (Number.isFinite(ageMs) && ageMs <= ttlMs) fresh = stale;
    }
  } catch {
    // Cache/database trouble must not block the public-source lookup.
  }

  if (fresh) return toResolution(fresh, isin);

  try {
    const latest = await fetchGleifIssuerCountry(
      isin,
      () => (generationByIsin.get(isin) ?? 0) === generation,
      stale?.status === "confirmed"
    );
    if ((generationByIsin.get(isin) ?? 0) !== generation) return null;
    if (latest) return latest;

    // Never downgrade a previously confirmed issuer because a source lookup
    // became empty or ambiguous after a transient upstream data change.
    return toResolution(stale, isin);
  } catch {
    if ((generationByIsin.get(isin) ?? 0) !== generation) return null;
    return toResolution(stale, isin);
  }
};

export const resolveIssuerCountryByIsin = async (rawIsin: string) => {
  const isin = normalizeIssuerIsin(rawIsin);
  if (!isin) return null;

  const memoKey = `isin:${isin}`;
  const memoized = resolutionMemo.get(memoKey);
  if (memoized !== undefined) return memoized;

  const existing = inFlightByIsin.get(isin);
  if (existing) return existing;

  const generation = generationByIsin.get(isin) ?? 0;
  const pending = resolveUncached(isin, generation)
    .then((resolution) => {
      // An answer computed before an invalidation must not outlive it.
      if ((generationByIsin.get(isin) ?? 0) === generation) resolutionMemo.set(memoKey, resolution);
      return resolution;
    })
    .finally(() => {
      if (inFlightByIsin.get(isin) === pending) inFlightByIsin.delete(isin);
    });
  inFlightByIsin.set(isin, pending);
  return pending;
};

/**
 * Resolves legacy stock lots that predate persisted ISINs. EODHD Search is
 * used only to recover a verified common-stock listing and its ISIN; the
 * listing's Country field is not used. GLEIF remains the country authority.
 */
export const resolveIssuerCountryByInstrument = async (
  identity: IssuerCountryInstrumentIdentity
) => {
  const existingIsin = normalizeIssuerIsin(identity.isin);
  if (existingIsin) return resolveIssuerCountryByIsin(existingIsin);

  // Legacy lots without an ISIN need an EODHD search first; that whole chain is what is memoised.
  const memoKey = `identity:${JSON.stringify([identity.symbol, identity.providerId, identity.exchange, identity.name])}`;
  const memoized = resolutionMemo.get(memoKey);
  if (memoized !== undefined) return memoized;

  const recoveredIsin = await resolveEodhdCommonStockIsin(identity);
  const resolution = recoveredIsin ? await resolveIssuerCountryByIsin(recoveredIsin) : null;
  resolutionMemo.set(memoKey, resolution);
  return resolution;
};

/** Explicit invalidation hook for a future authoritative issuer-profile refresh. */
export const invalidateIssuerCountryCacheForIsin = async (rawIsin: string) => {
  const isin = normalizeIssuerIsin(rawIsin);
  if (!isin) return;
  generationByIsin.set(isin, (generationByIsin.get(isin) ?? 0) + 1);
  inFlightByIsin.delete(isin);
  // Identity memo entries are not keyed by ISIN, so drop them all rather than risk a stale country.
  resolutionMemo.clear();
  await deleteMarketCachePayload(cacheKeyForIsin(isin));
};
