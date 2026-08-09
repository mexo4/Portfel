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
  PortfolioRealizedAdjustment,
  PortfolioSale,
  SubscriptionPlan,
  TreasuryBondQuote,
  TreasuryBondSeries,
  UserProfile,
} from "@/types/portfolio";

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
  const data = await requestJson<{ groups: EtfSearchGroup[] }>(
    `/api/instruments/search?${params.toString()}`,
    { signal }
  );

  return data.groups;
};

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
      const quote = await fetchAssetQuote(asset);
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

      if (!quote) {
        return asset;
      }

      return {
        ...asset,
        symbol: quote.symbol,
        latestPrice: quote.price,
        previousClose: quote.previousClose ?? asset.previousClose,
        marketCurrency: quote.marketCurrency,
        provider: quote.provider,
        providerId: quote.providerId ?? asset.providerId,
        priceScale: quote.priceScale ?? asset.priceScale,
        bondMeta: quote.bondMeta ?? asset.bondMeta,
        lastUpdatedAt: quote.fetchedAt,
        name: quote.name ?? asset.name,
      };
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

  const data = await requestJson<{ rates: FxRates; fetchedAt: string }>(
    `/api/fx${params.size > 0 ? `?${params.toString()}` : ""}`
  );
  return data;
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
  signal,
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  benchmarks?: PortfolioBenchmarkDefinition[];
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
    }),
  });
};
