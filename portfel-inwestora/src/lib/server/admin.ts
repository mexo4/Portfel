import { getCurrentAccountData } from "@/lib/server/auth";
import db from "@/lib/server/db";
import { normalizePortfolioState } from "@/lib/portfolio-state";
import type { PortfolioState, SubscriptionPlan, SubscriptionStatus } from "@/types/portfolio";

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  email_verified_at: string | null;
  subscription_plan: string;
  subscription_status: string;
  subscription_updated_at: string | null;
  profile_json: string;
  portfolio_json: string;
  created_at: string;
  updated_at: string;
  active_sessions: number;
};

export type AdminUserOverview = {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionUpdatedAt: string | null;
  country: string;
  preferredBroker: string;
  experienceLevel: string;
  assetsCount: number;
  uniqueAssetsCount: number;
  salesCount: number;
  realizedAdjustmentsCount: number;
  activeSessions: number;
  createdAt: string;
  updatedAt: string;
  portfolio: PortfolioState;
};

export type AdminDashboardData = {
  users: AdminUserOverview[];
  totals: {
    users: number;
    freeUsers: number;
    proUsers: number;
    verifiedUsers: number;
    activeSessions: number;
    openPositions: number;
    sales: number;
  };
};

const getAdminEmails = () => 
  [
    process.env.ADMIN_EMAIL,
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ]
    .map((email) => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

export const isAdminEmail = (email: string) =>
  getAdminEmails().includes(email.trim().toLowerCase());

const normalizeSubscriptionPlan = (plan: string): SubscriptionPlan =>
  plan === "pro" ? "pro" : "free";

const normalizeSubscriptionStatus = (status: string): SubscriptionStatus => {
  if (status === "trialing" || status === "past_due" || status === "canceled") {
    return status;
  }

  return "active";
};

const parseProfileValue = (profileJson: string, key: string) => {
  try {
    const profile = JSON.parse(profileJson) as Record<string, unknown>;
    const value = profile[key];
    return typeof value === "string" && value.trim() ? value.trim() : "brak";
  } catch {
    return "brak";
  }
};

const getUniqueAssetCount = (portfolio: PortfolioState) =>
  new Set(portfolio.assets.map((asset) => `${asset.kind}:${asset.symbol}`)).size;

const toAdminUserOverview = (row: AdminUserRow): AdminUserOverview => {
  const portfolio = normalizePortfolioState(JSON.parse(row.portfolio_json));

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    emailVerifiedAt: row.email_verified_at,
    subscriptionPlan: normalizeSubscriptionPlan(row.subscription_plan),
    subscriptionStatus: normalizeSubscriptionStatus(row.subscription_status),
    subscriptionUpdatedAt: row.subscription_updated_at,
    country: parseProfileValue(row.profile_json, "country"),
    preferredBroker: parseProfileValue(row.profile_json, "preferredBroker"),
    experienceLevel: parseProfileValue(row.profile_json, "experienceLevel"),
    assetsCount: portfolio.assets.length,
    uniqueAssetsCount: getUniqueAssetCount(portfolio),
    salesCount: portfolio.sales.length,
    realizedAdjustmentsCount: portfolio.realizedAdjustments.length,
    activeSessions: row.active_sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    portfolio,
  };
};

export const getAdminDashboardData = async (): Promise<AdminDashboardData | null> => {
  const accountData = await getCurrentAccountData();

  if (!accountData || !isAdminEmail(accountData.user.email)) {
    return null;
  }

  const rows = db
    .prepare(
      `
        SELECT
          users.id,
          users.email,
          users.display_name,
          users.email_verified_at,
          users.subscription_plan,
          users.subscription_status,
          users.subscription_updated_at,
          users.profile_json,
          users.portfolio_json,
          users.created_at,
          users.updated_at,
          COUNT(sessions.id) AS active_sessions
        FROM users
        LEFT JOIN sessions
          ON sessions.user_id = users.id
          AND sessions.expires_at > ?
        GROUP BY users.id
        ORDER BY users.created_at DESC
      `
    )
    .all(new Date().toISOString()) as AdminUserRow[];

  const users = rows.map(toAdminUserOverview);

  return {
    users,
    totals: {
      users: users.length,
      freeUsers: users.filter((user) => user.subscriptionPlan === "free").length,
      proUsers: users.filter((user) => user.subscriptionPlan === "pro").length,
      verifiedUsers: users.filter((user) => Boolean(user.emailVerifiedAt)).length,
      activeSessions: users.reduce((total, user) => total + user.activeSessions, 0),
      openPositions: users.reduce((total, user) => total + user.assetsCount, 0),
      sales: users.reduce((total, user) => total + user.salesCount, 0),
    },
  };
};
