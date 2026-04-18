import type {
  AuthenticatedUser,
  AssetKind,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  BenchmarkComparison,
  BenchmarkInvestment,
  FxRates,
  PortfolioAsset,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  UserProfile,
} from "@/types/portfolio";

type SearchParams = {
  query: string;
  kind: AssetKind;
  mode?: AssetSearchMode;
};

type QuoteRequest = Pick<
  PortfolioAsset,
  "symbol" | "kind" | "marketCurrency" | "provider" | "providerId" | "priceScale"
>;

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Request failed");
  }

  return (await response.json()) as T;
};

export const searchAssets = async ({ query, kind, mode }: SearchParams) => {
  const params = new URLSearchParams({
    q: query,
    kind,
  });

  if (mode) {
    params.set("mode", mode);
  }

  const data = await requestJson<{ results: AssetSearchResult[] }>(
    `/api/search?${params.toString()}`
  );

  return data.results;
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

export const refreshPortfolioQuotes = async (assets: PortfolioAsset[]) => {
  const refreshed = await Promise.all(
    assets.map(async (asset) => {
      const quote = await fetchAssetQuote(asset);
      if (!quote) return asset;

      return {
        ...asset,
        symbol: quote.symbol,
        latestPrice: quote.price,
        previousClose: quote.previousClose ?? asset.previousClose,
        marketCurrency: quote.marketCurrency,
        provider: quote.provider,
        providerId: quote.providerId ?? asset.providerId,
        priceScale: quote.priceScale ?? asset.priceScale,
        lastUpdatedAt: quote.fetchedAt,
        name: quote.name ?? asset.name,
      };
    })
  );

  return refreshed;
};

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
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
}) => {
  const data = await requestJson<{
    assets: PortfolioAsset[];
    sales: PortfolioSale[];
    realizedAdjustments: PortfolioRealizedAdjustment[];
  }>("/api/portfolio", {
    method: "PUT",
    body: JSON.stringify({ assets, sales, realizedAdjustments }),
  });

  return data;
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
  return requestJson<{ user: AuthenticatedUser }>("/api/auth/register", {
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
    previewUrl: string | null;
  }>("/api/auth/request-verification", {
    method: "POST",
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
