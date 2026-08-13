import type {
  AuthenticatedUser,
  AssetKind,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  EtfListing,
  EtfSearchGroup,
  BenchmarkComparison,
  BenchmarkInvestment,
  BondRedemptionQuote,
  BondSwapQuote,
  FxRates,
  CashHistoryEntry,
  PortfolioAsset,
  PortfolioBook,
  PortfolioDividend,
  PortfolioEngineSnapshot,
  PortfolioOperation,
  InvestmentPortfolio,
  PortfolioBenchmarkDefinition,
  PortfolioHistoryResponse,
  PortfolioHistoryScope,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  SubscriptionPlan,
  TreasuryBondQuote,
  TreasuryBondSeries,
  UserProfile,
} from "@/types/portfolio";
import { isGpwSymbol } from "@/lib/ticker";
import type { CorporateEventsResponse } from "@/lib/corporate-events";
import type { DashboardLayout } from "@/lib/dashboard-layout";

type SearchParams = {
  query: string;
  kind: AssetKind;
  mode?: AssetSearchMode;
  signal?: AbortSignal;
};

type QuoteRequest = Pick<
  PortfolioAsset,
  "symbol" | "kind" | "marketCurrency" | "provider" | "providerId" | "priceScale"
> & {
  purchaseDate?: string;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "Request failed";
    throw new ApiError(message, response.status, payload);
  }

  return (await response.json()) as T;
};

const fxRequestsInFlight = new Map<string, Promise<{ rates: FxRates; fetchedAt: string }>>();

type EtfSearchErrorPayload = {
  code?: unknown;
};

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");

const getEtfSearchErrorMessage = (status: number, payload: EtfSearchErrorPayload | null) => {
  const code = typeof payload?.code === "string" ? payload.code : "";

  if (status === 429 || code === "rate_limit") {
    return "Limit wyszukiwania został chwilowo wykorzystany. Spróbuj ponownie za moment.";
  }

  if (code === "configuration" || code === "invalid_credentials") {
    return "Wyszukiwanie ETF jest obecnie niedostępne.";
  }

  if (code === "network" || code === "timeout") {
    return "Nie udało się połączyć z usługą wyszukiwania ETF.";
  }

  return "Nie udało się wyszukać ETF-ów. Spróbuj ponownie.";
};

/**
 * ETF discovery has its own error contract.  It must never pass an HTML
 * response, browser transport error or provider detail through to the UI.
 */
const requestEtfSearch = async (url: string, signal?: AbortSignal) => {
  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new ApiError("Nie udało się połączyć z usługą wyszukiwania ETF.", 0, null);
  }

  const body = await response.text();
  let payload: unknown = null;

  if (body.trim()) {
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      payload = null;
    }
  }

  const errorPayload =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as EtfSearchErrorPayload)
      : null;

  if (!response.ok) {
    throw new ApiError(
      getEtfSearchErrorMessage(response.status, errorPayload),
      response.status,
      payload
    );
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("groups" in payload) ||
    !Array.isArray(payload.groups)
  ) {
    throw new ApiError("Nie udało się wyszukać ETF-ów. Spróbuj ponownie.", 502, null);
  }

  return payload.groups as EtfSearchGroup[];
};

export const searchAssets = async ({ query, kind, mode, signal }: SearchParams) => {
  const params = new URLSearchParams({
    q: query,
    kind,
  });

  if (mode) {
    params.set("mode", mode);
  }

  const data = await requestJson<{ results: AssetSearchResult[] }>(
    `/api/search?${params.toString()}`,
    { signal }
  );

  return data.results;
};

export const searchEtfInstruments = async ({ query, signal }: Pick<SearchParams, "query" | "signal">) => {
  const params = new URLSearchParams({ q: query });
  return requestEtfSearch(`/api/etf/search?${params.toString()}`, signal);
};

export const fetchCorporateEvents = async ({
  portfolioId,
  instrumentId,
  days = 60,
  signal,
}: {
  portfolioId: string;
  instrumentId?: string;
  days?: number;
  signal?: AbortSignal;
}) => {
  const params = new URLSearchParams({
    portfolio: portfolioId,
    days: String(days),
  });

  if (instrumentId) {
    params.set("instrumentId", instrumentId);
  }

  return requestJson<CorporateEventsResponse>(
    `/api/corporate-events?${params.toString()}`,
    { signal }
  );
};

export type DashboardLayoutResponse = {
  layout: DashboardLayout;
  revision: number;
  updatedAt: string | null;
};

export const fetchDashboardLayout = async (signal?: AbortSignal) =>
  requestJson<DashboardLayoutResponse>("/api/dashboard-layout", { signal });

export const saveDashboardLayout = async (layout: DashboardLayout) =>
  requestJson<DashboardLayoutResponse>("/api/dashboard-layout", {
    method: "PUT",
    body: JSON.stringify({ layout }),
  });

export const resolveEtfListingPrice = async (listing: EtfListing) => {
  const data = await requestJson<{ listing: EtfListing }>(
    "/api/instruments/etf/resolve-price",
    {
      method: "POST",
      body: JSON.stringify({ listing }),
    }
  );

  return data.listing;
};

export const fetchQuotePreview = async (request: QuoteRequest) => {
  const params = new URLSearchParams({
    symbol: request.symbol,
    kind: request.kind,
    marketCurrency: request.marketCurrency,
    provider: request.provider,
  });

  if (request.providerId) {
    params.set("providerId", request.providerId);
  }

  if (request.purchaseDate) {
    params.set("purchaseDate", request.purchaseDate);
  }

  if (typeof request.priceScale === "number" && Number.isFinite(request.priceScale)) {
    params.set("priceScale", String(request.priceScale));
  }

  try {
    const data = await requestJson<{ quote: AssetQuote }>(
      `/api/quote?${params.toString()}`
    );
    return data.quote;
  } catch {
    return null;
  }
};

export const fetchAssetQuote = fetchQuotePreview;

export const fetchTreasuryBondSeries = async ({
  code,
  purchaseDate,
}: {
  code: string;
  purchaseDate: string;
}) => {
  const params = new URLSearchParams({
    code,
    purchaseDate,
  });

  return requestJson<{
    series: TreasuryBondSeries;
    quote: TreasuryBondQuote;
  }>(`/api/bonds/series?${params.toString()}`);
};

export const fetchTreasuryBondRedemption = async ({
  code,
  purchaseDate,
  requestDate,
  quantity,
}: {
  code: string;
  purchaseDate: string;
  requestDate: string;
  quantity: number;
}) => {
  const params = new URLSearchParams({
    code,
    purchaseDate,
    requestDate,
    quantity: String(quantity),
  });

  return requestJson<{
    redemption: BondRedemptionQuote;
  }>(`/api/bonds/redemption?${params.toString()}`);
};

export const fetchTreasuryBondSwap = async ({
  sourceRedemption,
  targetCode,
  targetQuantity,
}: {
  sourceRedemption: BondRedemptionQuote;
  targetCode: string;
  targetQuantity: number;
}) => {
  return requestJson<{
    swap: BondSwapQuote;
  }>("/api/bonds/swap", {
    method: "POST",
    body: JSON.stringify({
      sourceRedemption,
      targetCode,
      targetQuantity,
    }),
  });
};

export type QuoteRefreshProgress = {
  completed: number;
  total: number;
};

export type PortfolioQuoteRefreshResult = {
  assets: PortfolioAsset[];
  total: number;
  missing: number;
};

const isUsableAssetQuote = (quote: AssetQuote | null | undefined): quote is AssetQuote =>
  Boolean(
    quote &&
      typeof quote.price === "number" &&
      Number.isFinite(quote.price) &&
      quote.price > 0 &&
      typeof quote.symbol === "string" &&
      quote.symbol.trim() &&
      typeof quote.marketCurrency === "string" &&
      quote.marketCurrency.trim() &&
      typeof quote.fetchedAt === "string" &&
      Number.isFinite(Date.parse(quote.fetchedAt))
  );

const getStoredQuoteFetchedAt = (asset: PortfolioAsset) =>
  asset.latestPriceFetchedAt ?? asset.lastUpdatedAt;

const getStoredQuoteMarketTimestamp = (asset: PortfolioAsset) =>
  asset.latestPriceMarketTimestamp;

const hasUsableStoredUnitPrice = (asset: PortfolioAsset) =>
  typeof asset.latestPrice === "number" &&
  Number.isFinite(asset.latestPrice) &&
  asset.latestPrice > 0;

/**
 * A provider can legitimately return the same market quote again.  Treating
 * a new HTTP fetch timestamp as a new quote caused the dashboard to rebuild
 * every portfolio, chart fallback and quote-snapshot payload on each polling
 * interval.  `fetchedAt` deliberately is not part of this comparison: it is
 * not a market-data change, and must not make an unchanged quote look newer.
 */
export const hasSameStoredQuoteSnapshot = (
  current: PortfolioAsset,
  next: PortfolioAsset
) =>
  current.symbol === next.symbol &&
  current.name === next.name &&
  current.latestPrice === next.latestPrice &&
  current.latestPriceDate === next.latestPriceDate &&
  current.latestPriceMarketTimestamp === next.latestPriceMarketTimestamp &&
  current.previousClose === next.previousClose &&
  current.marketCurrency === next.marketCurrency &&
  current.provider === next.provider &&
  current.providerId === next.providerId &&
  current.priceScale === next.priceScale &&
  JSON.stringify(current.bondMeta ?? null) === JSON.stringify(next.bondMeta ?? null);

const keepExistingAssetForUnchangedQuote = (
  current: PortfolioAsset,
  next: PortfolioAsset
) => (hasSameStoredQuoteSnapshot(current, next) ? current : next);

/**
 * Quote refresh updates market data, not the user's stored instrument
 * identity.  Polish equities are particularly sensitive because a bare
 * ticker can collide with an unrelated US listing (for example DIA).
 */
export const mergeQuoteIntoPortfolioAsset = (
  asset: PortfolioAsset,
  quote: AssetQuote | null | undefined
): PortfolioAsset => {
  // A failed, malformed or zero-valued response must never replace the last
  // known good price. This is the client-side half of stale-while-revalidate.
  if (!isUsableAssetQuote(quote)) {
    return asset;
  }

  const isGpwStock =
    asset.kind === "stock" &&
    (isGpwSymbol(asset.symbol) || asset.marketCurrency === "PLN");

  if (isGpwStock) {
    // A USD response cannot be a quote for the persisted GPW identity.  Do
    // not write its price, name, provider or currency into local state.
    if (quote.marketCurrency !== "PLN") {
      return asset;
    }

    return keepExistingAssetForUnchangedQuote(asset, {
      ...asset,
      latestPrice: quote.price,
      latestPriceDate: quote.priceDate ?? asset.latestPriceDate,
      latestPriceMarketTimestamp:
        quote.marketTimestamp ?? asset.latestPriceMarketTimestamp,
      latestPriceFetchedAt: quote.fetchedAt,
      previousClose: quote.previousClose ?? asset.previousClose,
      lastUpdatedAt: quote.fetchedAt,
    });
  }

  return keepExistingAssetForUnchangedQuote(asset, {
    ...asset,
    symbol: quote.symbol,
    latestPrice: quote.price,
    latestPriceDate: quote.priceDate ?? asset.latestPriceDate,
    latestPriceMarketTimestamp:
      quote.marketTimestamp ?? asset.latestPriceMarketTimestamp,
    latestPriceFetchedAt: quote.fetchedAt,
    previousClose: quote.previousClose ?? asset.previousClose,
    marketCurrency: quote.marketCurrency,
    provider: quote.provider,
    providerId: quote.providerId ?? asset.providerId,
    priceScale: quote.priceScale ?? asset.priceScale,
    bondMeta: quote.bondMeta ?? asset.bondMeta,
    lastUpdatedAt: quote.fetchedAt,
    name: quote.name ?? asset.name,
  });
};

/**
 * Applies a completed refresh to the state that is current at commit time.
 * A request may have started from an older React snapshot, so this helper
 * refuses to replace a newer last-known-good quote with an older or malformed
 * snapshot. Instrument identity protection stays in mergeQuoteIntoPortfolioAsset.
 */
export const applyRefreshedPortfolioAssetSnapshot = (
  current: PortfolioAsset,
  refreshed: PortfolioAsset | undefined
): PortfolioAsset => {
  if (!refreshed || !hasUsableStoredUnitPrice(refreshed)) {
    return current;
  }

  const refreshedAt = getStoredQuoteFetchedAt(refreshed);
  const currentAt = getStoredQuoteFetchedAt(current);
  const refreshedMarketAt = getStoredQuoteMarketTimestamp(refreshed);
  const currentMarketAt = getStoredQuoteMarketTimestamp(current);
  const refreshedMarketTime = refreshedMarketAt
    ? Date.parse(refreshedMarketAt)
    : Number.NaN;
  const currentMarketTime = currentMarketAt ? Date.parse(currentMarketAt) : Number.NaN;
  const refreshedTime = refreshedAt ? Date.parse(refreshedAt) : Number.NaN;
  const currentTime = currentAt ? Date.parse(currentAt) : Number.NaN;

  if (
    hasUsableStoredUnitPrice(current) &&
    ((Number.isFinite(currentMarketTime) &&
      (!Number.isFinite(refreshedMarketTime) || refreshedMarketTime < currentMarketTime)) ||
      (!Number.isFinite(currentMarketTime) &&
        (!Number.isFinite(refreshedTime) ||
          (Number.isFinite(currentTime) && refreshedTime < currentTime))))
  ) {
    return current;
  }

  const merged = mergeQuoteIntoPortfolioAsset(current, {
    symbol: refreshed.symbol,
    price: refreshed.latestPrice!,
    marketCurrency: refreshed.marketCurrency,
    provider: refreshed.provider,
    providerId: refreshed.providerId,
    priceScale: refreshed.priceScale,
    name: refreshed.name,
    fetchedAt: refreshedAt ?? new Date().toISOString(),
    priceDate: refreshed.latestPriceDate,
    marketTimestamp: refreshed.latestPriceMarketTimestamp,
    previousClose: refreshed.previousClose,
    bondMeta: refreshed.bondMeta,
  });

  return hasSameStoredQuoteSnapshot(current, merged) ? current : merged;
};

export const refreshPortfolioQuotesWithProgress = async (
  assets: PortfolioAsset[],
  onProgress?: (progress: QuoteRefreshProgress) => void
): Promise<PortfolioQuoteRefreshResult> => {
  const quoteRequestKey = (asset: PortfolioAsset) =>
    [
      asset.kind,
      asset.symbol,
      asset.marketCurrency,
      asset.provider,
      asset.providerId ?? "",
      asset.priceScale ?? "",
    ].join(":");
  const assetsByQuoteKey = new Map<string, PortfolioAsset>();

  assets.forEach((asset) => {
    const key = quoteRequestKey(asset);

    if (!assetsByQuoteKey.has(key)) {
      assetsByQuoteKey.set(key, asset);
    }
  });

  const quoteRequests = Array.from(assetsByQuoteKey.entries());
  const quotesByKey = new Map<string, AssetQuote | null>();
  let nextRequestIndex = 0;
  let completed = 0;
  let missing = 0;
  const workerCount = Math.min(6, quoteRequests.length);

  onProgress?.({ completed, total: quoteRequests.length });

  const refreshNextQuote = async () => {
    while (nextRequestIndex < quoteRequests.length) {
      const requestIndex = nextRequestIndex;
      nextRequestIndex += 1;
      const [key, asset] = quoteRequests[requestIndex];
      const responseQuote = await fetchAssetQuote(asset);
      const quote = isUsableAssetQuote(responseQuote) ? responseQuote : null;
      quotesByKey.set(key, quote);

      if (!quote) {
        missing += 1;
      }

      completed += 1;
      onProgress?.({ completed, total: quoteRequests.length });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, refreshNextQuote));

  return {
    assets: assets.map((asset) => {
      const quote = quotesByKey.get(quoteRequestKey(asset));

      return mergeQuoteIntoPortfolioAsset(asset, quote);
    }),
    total: quoteRequests.length,
    missing,
  };
};

export const refreshPortfolioQuotes = async (assets: PortfolioAsset[]) =>
  (await refreshPortfolioQuotesWithProgress(assets)).assets;

export const fetchFxRates = async (codes?: string[], date?: string) => {
  const params = new URLSearchParams();

  if (codes && codes.length > 0) {
    params.set("codes", codes.join(","));
  }

  if (date) {
    params.set("date", date);
  }

  const url = `/api/fx${params.size > 0 ? `?${params.toString()}` : ""}`;
  const existing = fxRequestsInFlight.get(url);
  if (existing) {
    return existing;
  }

  const request = requestJson<{ rates: FxRates; fetchedAt: string }>(url).finally(() => {
    fxRequestsInFlight.delete(url);
  });
  fxRequestsInFlight.set(url, request);
  return request;
};

export const saveUserProfile = async (profile: UserProfile) => {
  const data = await requestJson<{ user: AuthenticatedUser; profile: UserProfile }>(
    "/api/profile",
    {
      method: "PUT",
      body: JSON.stringify({ profile }),
    }
  );

  return data;
};

export const savePortfolioState = async ({
  assets,
  sales,
  realizedAdjustments,
  portfolios,
  activePortfolioId,
  portfolioRevision,
}: {
  assets?: PortfolioAsset[];
  sales?: PortfolioSale[];
  realizedAdjustments?: PortfolioRealizedAdjustment[];
  portfolios?: InvestmentPortfolio[];
  activePortfolioId?: string;
  portfolioRevision?: number;
}) => {
  const data = await requestJson<{
    saved: true;
    portfolios: InvestmentPortfolio[];
    activePortfolioId: string;
    portfolioRevision: number;
  }>("/api/portfolio", {
    method: "PUT",
    body: JSON.stringify(
      portfolios
        ? { portfolios, activePortfolioId, portfolioRevision }
        : {
            assets: assets ?? [],
            sales: sales ?? [],
            realizedAdjustments: realizedAdjustments ?? [],
            portfolioRevision,
          }
    ),
  });

  return data;
};

export const savePortfolioQuoteSnapshots = async (
  snapshots: Array<{
    portfolioId: string;
    assetId: string;
    latestPrice: number;
    latestPriceDate?: string;
    latestPriceMarketTimestamp?: string;
    latestPriceFetchedAt?: string;
    previousClose?: number;
    lastUpdatedAt?: string;
    marketCurrency?: PortfolioAsset["marketCurrency"];
    provider?: PortfolioAsset["provider"];
    providerId?: string;
    priceScale?: number;
  }>
) =>
  requestJson<{ saved: number }>("/api/portfolio/quotes", {
    method: "POST",
    body: JSON.stringify({ snapshots }),
  });

export const fetchPortfolioCore = async () => {
  return requestJson<{
    schemaVersion: 2;
    portfolios: InvestmentPortfolio[];
    activePortfolioId: string;
    activePortfolio: InvestmentPortfolio;
    snapshot: PortfolioEngineSnapshot;
  }>("/api/portfolio/v2");
};

export const savePortfolioCore = async (portfolioBook: PortfolioBook) => {
  return requestJson<PortfolioBook>("/api/portfolio/v2", {
    method: "PUT",
    body: JSON.stringify(portfolioBook),
  });
};

export const fetchPortfolioOperations = async (portfolioId?: string) => {
  const params = new URLSearchParams();

  if (portfolioId) {
    params.set("portfolioId", portfolioId);
  }

  return requestJson<{
    portfolioId: string;
    operations: PortfolioOperation[];
  }>(`/api/portfolio/v2/operations${params.size > 0 ? `?${params.toString()}` : ""}`);
};

export const appendPortfolioOperation = async (
  operation: Partial<PortfolioOperation>,
  portfolioId?: string
) => {
  return requestJson<{
    operation: PortfolioOperation;
    portfolios: InvestmentPortfolio[];
    activePortfolioId: string;
  }>("/api/portfolio/v2/operations", {
    method: "POST",
    body: JSON.stringify({ portfolioId, operation }),
  });
};

export const fetchPortfolioDividends = async (portfolioId?: string) => {
  const params = new URLSearchParams();

  if (portfolioId) {
    params.set("portfolioId", portfolioId);
  }

  return requestJson<{
    portfolioId: string;
    dividends: PortfolioDividend[];
  }>(`/api/portfolio/v2/dividends${params.size > 0 ? `?${params.toString()}` : ""}`);
};

export const createPortfolioDividend = async (
  dividend: Partial<PortfolioDividend>,
  portfolioId?: string
) => {
  return requestJson<{
    dividend: PortfolioDividend;
    portfolios: InvestmentPortfolio[];
    activePortfolioId: string;
  }>("/api/portfolio/v2/dividends", {
    method: "POST",
    body: JSON.stringify({ ...dividend, portfolioId }),
  });
};

export const updatePortfolioDividend = async (
  dividendId: string,
  dividend: Partial<PortfolioDividend>,
  portfolioId?: string
) => {
  return requestJson<{
    dividend: PortfolioDividend;
    portfolios: InvestmentPortfolio[];
    activePortfolioId: string;
  }>(`/api/portfolio/v2/dividends/${encodeURIComponent(dividendId)}`, {
    method: "PUT",
    body: JSON.stringify({ ...dividend, portfolioId }),
  });
};

export const deletePortfolioDividend = async (
  dividendId: string,
  portfolioId?: string
) => {
  const params = new URLSearchParams();

  if (portfolioId) {
    params.set("portfolioId", portfolioId);
  }

  return requestJson<{
    success: boolean;
    portfolios: InvestmentPortfolio[];
    activePortfolioId: string;
  }>(
    `/api/portfolio/v2/dividends/${encodeURIComponent(dividendId)}${
      params.size > 0 ? `?${params.toString()}` : ""
    }`,
    { method: "DELETE" }
  );
};

export const fetchCashHistory = async (portfolioId?: string) => {
  const params = new URLSearchParams();

  if (portfolioId) {
    params.set("portfolioId", portfolioId);
  }

  return requestJson<{
    portfolioId: string;
    history: CashHistoryEntry[];
  }>(`/api/portfolio/v2/cash-history${params.size > 0 ? `?${params.toString()}` : ""}`);
};

export const loginUser = async (payload: { email: string; password: string }) => {
  return requestJson<{ user: AuthenticatedUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const registerUser = async (payload: {
  displayName: string;
  email: string;
  password: string;
}) => {
  return requestJson<{
    user: AuthenticatedUser;
    requiresVerification: boolean;
    verificationSent: boolean;
    previewUrl: string | null;
  }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const logoutUser = async () => {
  return requestJson<{ success: boolean }>("/api/auth/logout", {
    method: "POST",
  });
};

export const requestEmailVerification = async () => {
  return requestJson<{
    success: boolean;
    alreadyVerified: boolean;
    sent: boolean;
    previewUrl: string | null;
  }>("/api/auth/request-verification", {
    method: "POST",
  });
};

export const deleteAdminUser = async (userId: string) => {
  return requestJson<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
};

export const requestPasswordReset = async (email: string) => {
  return requestJson<{
    success: boolean;
    previewUrl: string | null;
  }>("/api/auth/request-password-reset", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
};

export const resetPassword = async (payload: { token: string; password: string }) => {
  return requestJson<{ success: boolean }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const changePassword = async (payload: {
  currentPassword: string;
  newPassword: string;
}) => {
  return requestJson<{ success: boolean }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const updateSubscriptionPlan = async (plan: SubscriptionPlan) => {
  return requestJson<{ user: AuthenticatedUser; plan: SubscriptionPlan }>("/api/subscription", {
    method: "PUT",
    body: JSON.stringify({ plan }),
  });
};

export const fetchBenchmarkComparisons = async (
  investments: BenchmarkInvestment[]
) => {
  const data = await requestJson<{ comparisons: BenchmarkComparison[] }>(
    "/api/benchmarks",
    {
      method: "POST",
      body: JSON.stringify({ investments }),
    }
  );

  return data.comparisons;
};

export const fetchPortfolioHistory = async ({
  assets,
  sales,
  realizedAdjustments,
  benchmarks,
  portfolioScopes,
  signal,
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  benchmarks?: PortfolioBenchmarkDefinition[];
  portfolioScopes?: PortfolioHistoryScope[];
  signal?: AbortSignal;
}) => {
  return requestJson<PortfolioHistoryResponse>("/api/portfolio-history", {
    method: "POST",
    signal,
    body: JSON.stringify({
      assets,
      sales,
      realizedAdjustments,
      benchmarks,
      portfolioScopes,
    }),
  });
};
