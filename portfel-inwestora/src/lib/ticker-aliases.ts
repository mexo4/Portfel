export {
  TICKER_ALIAS_MAP,
  getCanonicalPortfolioSymbol,
  getTickerAliasCandidates,
  getTickerLookupCandidates,
  normalizeBrokerTicker,
  resolveTickerAlias,
  resolveTickerIdentity,
} from "@/lib/ticker-normalizer";
export type {
  TickerAliasResolution,
  TickerIdentity,
  TickerLookupCandidate,
} from "@/lib/ticker-normalizer";
