import {
  createPortfolioBenchmarkDefinition,
  hasUnresolvableEtfVenue,
  rankBenchmarkSearchResults,
} from "@/lib/benchmark-search";
import { normalizeSymbol } from "@/lib/ticker";
import type {
  EtfListing,
  EtfSearchGroup,
  PortfolioBenchmarkDefinition,
} from "@/types/portfolio";

/**
 * Until 23.11.2026 the benchmark picker saved an ETF as found: one arbitrary
 * OpenFIGI venue, no price source. For a fund listed on many venues (VWRD) that
 * was usually a venue without prices, so the benchmark stayed in the list and
 * never drew a line. Those entries are saved in the user's portfolio or browser
 * and would stay broken, so they are repaired by looking the ticker up again.
 */

/** Only an ETF saved without a provider id can be repaired this way. */
export const isRepairableEtfBenchmark = (benchmark: PortfolioBenchmarkDefinition) =>
  benchmark.kind === "etf" && !benchmark.providerId?.trim();

const MAX_VENUES_TRIED = 3;

const isEtfListing = (result: { kind: string }): result is EtfListing => result.kind === "etf";

/**
 * Finds a venue of the same ticker that has a price source and builds the
 * benchmark again from it. `null` when there is none: the entry is left as it
 * is, and the user is told it has no quotes.
 */
export const repairEtfBenchmark = async ({
  benchmark,
  searchEtfs,
  resolvePrice,
}: {
  benchmark: PortfolioBenchmarkDefinition;
  searchEtfs: (query: string) => Promise<EtfSearchGroup[]>;
  resolvePrice: (listing: EtfListing) => Promise<EtfListing>;
}): Promise<PortfolioBenchmarkDefinition | null> => {
  const ticker = normalizeSymbol(benchmark.symbol);
  const groups = await searchEtfs(benchmark.symbol);
  // The search is a text search; only listings of this very ticker qualify.
  const sameTicker = groups
    .flatMap((group) => group.listings)
    .filter((listing) => normalizeSymbol(listing.symbol) === ticker);
  const candidates = rankBenchmarkSearchResults(benchmark.symbol, sameTicker)
    .filter(isEtfListing)
    .filter((listing) => !hasUnresolvableEtfVenue(listing))
    .slice(0, MAX_VENUES_TRIED);

  for (const candidate of candidates) {
    const resolved = await resolvePrice(candidate).catch(() => null);

    if (!resolved || resolved.priceStatus === "unavailable" || !resolved.providerId) {
      continue;
    }

    // The saved name is what the user chose and sees; the fund is the same.
    return {
      ...createPortfolioBenchmarkDefinition(resolved, "etf"),
      name: benchmark.name,
    };
  }

  return null;
};
