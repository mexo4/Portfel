import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  getPrivateCalendarSubscriptionUrl,
  normalizeCalendarSubscriptionPayload,
  type CalendarSubscription,
  type CalendarSubscriptionPayload,
  type CalendarSubscriptionPortfolio,
  type CalendarSubscriptionScope,
} from "@/lib/calendar-subscriptions";
import { ICAL_CATEGORIES, type IcalCategory } from "@/lib/gpw-ical";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import { query, queryOne } from "@/lib/server/db";
import { getPortfolioTrackedInputs } from "@/lib/server/espi";
import { getUserWatchlist } from "@/lib/server/watchlist";
import type { InvestmentPortfolio } from "@/types/portfolio";

type SubscriptionRow = {
  id: string;
  user_id: string;
  name: string;
  scope_mode: CalendarSubscriptionScope;
  categories_json: string;
  portfolio_ids_json: string;
  manual_tickers_json: string;
  access_token: string;
  token_hash: string;
  token_version: number;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type UserPortfolioRow = { portfolio_json: string };

export type CalendarSubscriptionContext = {
  portfolios: InvestmentPortfolio[];
  portfolioOptions: CalendarSubscriptionPortfolio[];
  watchlistTickers: string[];
  allGpwIssuerCount: number;
};

const parseStringArray = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const createToken = () => randomBytes(32).toString("base64url");

const getUserPortfolios = async (userId: string) => {
  const stored = await queryOne<UserPortfolioRow>("SELECT portfolio_json FROM users WHERE id = $1", [userId]);
  if (!stored?.portfolio_json) return [];
  try {
    return normalizePortfolioBook(JSON.parse(stored.portfolio_json)).portfolios;
  } catch {
    return [];
  }
};

export const getCalendarSubscriptionContext = async (
  userId: string,
  { includeMarketCount = true }: { includeMarketCount?: boolean } = {},
): Promise<CalendarSubscriptionContext> => {
  const [portfolios, watchlist, count] = await Promise.all([
    getUserPortfolios(userId),
    getUserWatchlist(userId),
    includeMarketCount
      ? queryOne<{ count: number }>("SELECT COUNT(*)::int AS count FROM corporate_event_instruments WHERE market = 'GPW'")
      : Promise.resolve(undefined),
  ]);
  return {
    portfolios,
    portfolioOptions: portfolios.map(({ id, name }) => ({ id, name })),
    watchlistTickers: [...new Set(watchlist.map((item) => item.canonicalKey.replace(/^gpw:ticker:/, "").toUpperCase()))].sort(),
    allGpwIssuerCount: count?.count ?? 0,
  };
};

const selectedPortfolios = (context: CalendarSubscriptionContext, ids: readonly string[]) => {
  if (ids.length === 0) return context.portfolios;
  const allowed = new Set(ids);
  return context.portfolios.filter((portfolio) => allowed.has(portfolio.id));
};

export const resolveCalendarSubscriptionTickers = (
  scope: CalendarSubscriptionScope,
  portfolioIds: readonly string[],
  manualTickers: readonly string[],
  context: CalendarSubscriptionContext,
) => {
  if (scope === "ALL_GPW") return [];
  if (scope === "MANUAL") return [...new Set(manualTickers)].sort();
  const portfolioTickers = getPortfolioTrackedInputs(selectedPortfolios(context, portfolioIds))
    .map((instrument) => instrument.ticker.toUpperCase());
  if (scope === "PORTFOLIO") return [...new Set(portfolioTickers)].sort();
  if (scope === "WATCHLIST") return context.watchlistTickers;
  return [...new Set([...portfolioTickers, ...context.watchlistTickers])].sort();
};

const toSubscription = (
  row: SubscriptionRow,
  context: CalendarSubscriptionContext,
): CalendarSubscription => {
  const categories = ICAL_CATEGORIES.filter((category) => parseStringArray(row.categories_json).includes(category));
  const portfolioIds = parseStringArray(row.portfolio_ids_json);
  const manualTickers = parseStringArray(row.manual_tickers_json);
  const tickers = resolveCalendarSubscriptionTickers(row.scope_mode, portfolioIds, manualTickers, context);
  return {
    id: row.id,
    name: row.name,
    scope: row.scope_mode,
    categories,
    portfolioIds,
    manualTickers,
    issuerCount: row.scope_mode === "ALL_GPW" ? context.allGpwIssuerCount : tickers.length,
    feedUrl: getPrivateCalendarSubscriptionUrl(row.access_token),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const listRows = (userId: string) => query<SubscriptionRow>(
  `SELECT id, user_id, name, scope_mode, categories_json, portfolio_ids_json,
          manual_tickers_json, access_token, token_hash, token_version,
          revoked_at, created_at, updated_at
   FROM user_calendar_subscriptions
   WHERE user_id = $1 AND revoked_at IS NULL
   ORDER BY updated_at DESC, id ASC`,
  [userId],
);

export const listCalendarSubscriptions = async (userId: string) => {
  const [rows, context] = await Promise.all([listRows(userId), getCalendarSubscriptionContext(userId)]);
  return {
    subscriptions: rows.map((row) => toSubscription(row, context)),
    portfolios: context.portfolioOptions,
  };
};

const validateOwnedPortfolioIds = (
  payload: CalendarSubscriptionPayload,
  context: CalendarSubscriptionContext,
) => {
  const allowed = new Set(context.portfolioOptions.map((portfolio) => portfolio.id));
  if (payload.portfolioIds.some((id) => !allowed.has(id))) {
    throw new Error("CALENDAR_SUBSCRIPTION_PORTFOLIO_FORBIDDEN");
  }
};

export const createCalendarSubscription = async (userId: string, raw: unknown) => {
  const payload = normalizeCalendarSubscriptionPayload(raw);
  if (!payload) throw new Error("CALENDAR_SUBSCRIPTION_INVALID");
  const context = await getCalendarSubscriptionContext(userId);
  validateOwnedPortfolioIds(payload, context);
  const token = createToken();
  const now = new Date().toISOString();
  const row = await queryOne<SubscriptionRow>(
    `INSERT INTO user_calendar_subscriptions (
       id, user_id, name, scope_mode, categories_json, portfolio_ids_json,
       manual_tickers_json, access_token, token_hash, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
     RETURNING *`,
    [randomUUID(), userId, payload.name, payload.scope, JSON.stringify(payload.categories),
      JSON.stringify(payload.portfolioIds), JSON.stringify(payload.manualTickers), token, hashToken(token), now],
  );
  if (!row) throw new Error("CALENDAR_SUBSCRIPTION_SAVE_FAILED");
  return toSubscription(row, context);
};

export const updateCalendarSubscription = async (userId: string, id: string, raw: unknown) => {
  const payload = normalizeCalendarSubscriptionPayload(raw);
  if (!payload) throw new Error("CALENDAR_SUBSCRIPTION_INVALID");
  const context = await getCalendarSubscriptionContext(userId);
  validateOwnedPortfolioIds(payload, context);
  const now = new Date().toISOString();
  const row = await queryOne<SubscriptionRow>(
    `UPDATE user_calendar_subscriptions
     SET name=$3, scope_mode=$4, categories_json=$5, portfolio_ids_json=$6,
         manual_tickers_json=$7, updated_at=$8
     WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
     RETURNING *`,
    [id, userId, payload.name, payload.scope, JSON.stringify(payload.categories),
      JSON.stringify(payload.portfolioIds), JSON.stringify(payload.manualTickers), now],
  );
  if (!row) throw new Error("CALENDAR_SUBSCRIPTION_NOT_FOUND");
  return toSubscription(row, context);
};

export const revokeCalendarSubscription = async (userId: string, id: string) => {
  const now = new Date().toISOString();
  const rows = await query<{ id: string }>(
    `UPDATE user_calendar_subscriptions SET revoked_at=$3, updated_at=$3
     WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,
    [id, userId, now],
  );
  return rows.length > 0;
};

export const rotateCalendarSubscriptionToken = async (userId: string, id: string) => {
  const token = createToken();
  const now = new Date().toISOString();
  const row = await queryOne<SubscriptionRow>(
    `UPDATE user_calendar_subscriptions
     SET access_token=$3, token_hash=$4, token_version=token_version+1, updated_at=$5
     WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING *`,
    [id, userId, token, hashToken(token), now],
  );
  if (!row) throw new Error("CALENDAR_SUBSCRIPTION_NOT_FOUND");
  return toSubscription(row, await getCalendarSubscriptionContext(userId));
};

export const getCalendarSubscriptionByToken = async (token: string) => {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const row = await queryOne<SubscriptionRow>(
    `SELECT id, user_id, name, scope_mode, categories_json, portfolio_ids_json,
            manual_tickers_json, access_token, token_hash, token_version,
            revoked_at, created_at, updated_at
     FROM user_calendar_subscriptions
     WHERE token_hash=$1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
  if (!row) return null;
  const categories = ICAL_CATEGORIES.filter((category) => parseStringArray(row.categories_json).includes(category));
  if (categories.length === 0) return null;
  const needsPortfolios = row.scope_mode === "PORTFOLIO" || row.scope_mode === "PORTFOLIO_AND_WATCHLIST";
  const needsWatchlist = row.scope_mode === "WATCHLIST" || row.scope_mode === "PORTFOLIO_AND_WATCHLIST";
  const [portfolios, watchlist] = await Promise.all([
    needsPortfolios ? getUserPortfolios(row.user_id) : Promise.resolve([]),
    needsWatchlist ? getUserWatchlist(row.user_id) : Promise.resolve([]),
  ]);
  const context: CalendarSubscriptionContext = {
    portfolios,
    portfolioOptions: portfolios.map(({ id, name }) => ({ id, name })),
    watchlistTickers: [...new Set(watchlist.map((item) => item.canonicalKey.replace(/^gpw:ticker:/, "").toUpperCase()))].sort(),
    allGpwIssuerCount: 0,
  };
  return {
    id: row.id,
    name: row.name,
    categories: categories as IcalCategory[],
    tickers: resolveCalendarSubscriptionTickers(
      row.scope_mode,
      parseStringArray(row.portfolio_ids_json),
      parseStringArray(row.manual_tickers_json),
      context,
    ),
    sourceUrl: getPrivateCalendarSubscriptionUrl(token),
  };
};
