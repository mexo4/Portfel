import { ICAL_CATEGORIES, type IcalCategory } from "@/lib/gpw-ical";

export const CALENDAR_SUBSCRIPTION_SCOPES = [
  "ALL_GPW",
  "PORTFOLIO",
  "WATCHLIST",
  "PORTFOLIO_AND_WATCHLIST",
  "MANUAL",
] as const;

export type CalendarSubscriptionScope = (typeof CALENDAR_SUBSCRIPTION_SCOPES)[number];

export type CalendarSubscription = {
  id: string;
  name: string;
  scope: CalendarSubscriptionScope;
  categories: IcalCategory[];
  portfolioIds: string[];
  manualTickers: string[];
  issuerCount: number;
  feedUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type CalendarSubscriptionPortfolio = {
  id: string;
  name: string;
};

export type CalendarSubscriptionPayload = Pick<
  CalendarSubscription,
  "name" | "scope" | "categories" | "portfolioIds" | "manualTickers"
>;

export const isCalendarSubscriptionScope = (value: unknown): value is CalendarSubscriptionScope =>
  typeof value === "string" && CALENDAR_SUBSCRIPTION_SCOPES.includes(value as CalendarSubscriptionScope);

export const normalizeCalendarSubscriptionPayload = (
  value: unknown,
): CalendarSubscriptionPayload | null => {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const scope = input.scope;
  const rawCategories = Array.isArray(input.categories) ? input.categories : [];
  const categories = rawCategories.length
    ? ICAL_CATEGORIES.filter((category) => rawCategories.includes(category))
    : [];
  const rawPortfolioIds = Array.isArray(input.portfolioIds) ? input.portfolioIds : [];
  const portfolioIds = Array.isArray(input.portfolioIds)
    ? [...new Set(input.portfolioIds.filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(item)))].sort()
    : [];
  const rawManualTickers = Array.isArray(input.manualTickers) ? input.manualTickers : [];
  const manualTickers = Array.isArray(input.manualTickers)
    ? [...new Set(input.manualTickers
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toUpperCase())
        .filter((item) => /^[A-Z0-9]{1,12}$/.test(item)))].sort()
    : [];

  if (!name || name.length > 80 || !isCalendarSubscriptionScope(scope) || categories.length === 0) return null;
  if (portfolioIds.length !== new Set(rawPortfolioIds).size || manualTickers.length !== new Set(rawManualTickers).size) return null;
  if (portfolioIds.length > 50 || manualTickers.length > 30) return null;
  if (scope === "MANUAL" && manualTickers.length === 0) return null;

  return { name, scope, categories, portfolioIds, manualTickers };
};

export const getPrivateCalendarSubscriptionUrl = (token: string) =>
  `https://mexo.com.pl/api/calendar/feed/${encodeURIComponent(token)}`;
