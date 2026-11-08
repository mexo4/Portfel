import type { AuthenticatedUser, SubscriptionPlan, UserRole } from "@/types/portfolio";
import { FREE_PLAN_ASSET_LIMIT, FREE_PLAN_PORTFOLIO_LIMIT } from "@/lib/constants";

export type EntitlementDecision = "included" | "not-included" | "pending";
export type EntitlementFeature =
  | "advancedAnalytics"
  | "benchmarks"
  | "investmentTools"
  | "espi";

type LimitDecision = { status: "confirmed"; value: number | null } | { status: "pending" };

export type PlanDefinition = {
  id: SubscriptionPlan;
  name: string;
  pricePln: number;
  periodDays: 30 | null;
  selfServicePurchase: false;
  limits: {
    portfolios: LimitDecision;
    assetsPerPortfolio: LimitDecision;
  };
  features: Record<EntitlementFeature, EntitlementDecision>;
};

const undecidedFeatures = (): Record<EntitlementFeature, EntitlementDecision> => ({
  advancedAnalytics: "pending",
  benchmarks: "pending",
  investmentTools: "pending",
  // The ESPI source policy permits reuse with attribution; reading this
  // public-market information is available to every authenticated account.
  espi: "included",
});

const confirmedLimit = (value: number | null): LimitDecision => ({ status: "confirmed", value });
const pendingLimit = (): LimitDecision => ({ status: "pending" });

/**
 * Product source of truth. Pending entries are deliberate: only Free limits
 * and legacy Pro behavior are currently evidenced in the repository.
 */
export const PLAN_DEFINITIONS: Record<SubscriptionPlan, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    pricePln: 0,
    periodDays: null,
    selfServicePurchase: false,
    limits: {
      portfolios: confirmedLimit(FREE_PLAN_PORTFOLIO_LIMIT),
      assetsPerPortfolio: confirmedLimit(FREE_PLAN_ASSET_LIMIT),
    },
    features: undecidedFeatures(),
  },
  basic: {
    id: "basic",
    name: "Basic",
    pricePln: 3.99,
    periodDays: 30,
    selfServicePurchase: false,
    limits: { portfolios: pendingLimit(), assetsPerPortfolio: pendingLimit() },
    features: undecidedFeatures(),
  },
  standard: {
    id: "standard",
    name: "Standard",
    pricePln: 6.99,
    periodDays: 30,
    selfServicePurchase: false,
    limits: { portfolios: pendingLimit(), assetsPerPortfolio: pendingLimit() },
    features: undecidedFeatures(),
  },
  pro: {
    id: "pro",
    name: "Pro",
    pricePln: 11.99,
    periodDays: 30,
    selfServicePurchase: false,
    // Existing Pro accounts keep the current no-position-cap behavior. The
    // old UI promised more portfolios, and the server did not enforce a cap.
    limits: { portfolios: confirmedLimit(null), assetsPerPortfolio: confirmedLimit(null) },
    // There is no operator-approved plan matrix yet. Existing Pro accounts
    // keep their historical resource-limit behavior, but features stay pending
    // until product explicitly assigns them to a tier.
    features: undecidedFeatures(),
  },
  expert: {
    id: "expert",
    name: "Expert",
    pricePln: 14.99,
    periodDays: 30,
    selfServicePurchase: false,
    limits: { portfolios: pendingLimit(), assetsPerPortfolio: pendingLimit() },
    features: undecidedFeatures(),
  },
};

export const SUBSCRIPTION_PLAN_IDS = Object.keys(PLAN_DEFINITIONS) as SubscriptionPlan[];

/**
 * Source-rights rollout gate. Public read access must remain off until the
 * operator confirms reuse terms for every canonical ESPI source in use.
 */
export const isPublicEspiReadEnabled = () =>
  process.env.NEXT_PUBLIC_ESPI_PUBLIC_READ_ACCESS === "true";

export type EntitlementSubject = Pick<
  AuthenticatedUser,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "subscriptionExpiresAt"
  | "role"
  | "testerAccess"
  | "espiAccess"
>;

export type EffectiveEntitlements = {
  assignedPlan: SubscriptionPlan;
  effectivePlan: SubscriptionPlan;
  isExpired: boolean;
  role: UserRole;
  testerAccess: boolean;
  limits: {
    portfolios: number | null;
    assetsPerPortfolio: number | null;
    decisionsPending: boolean;
  };
  features: Record<EntitlementFeature, EntitlementDecision>;
};

const isPlanUsable = (subject: EntitlementSubject, now: number) => {
  if (subject.subscriptionPlan === "free") return true;
  if (subject.subscriptionStatus !== "active" && subject.subscriptionStatus !== "trialing") return false;
  if (!subject.subscriptionExpiresAt) return subject.subscriptionPlan === "pro";
  const expiry = Date.parse(subject.subscriptionExpiresAt);
  return Number.isFinite(expiry) && expiry > now;
};

export const resolveEffectiveEntitlements = (
  subject: EntitlementSubject,
  now = Date.now()
): EffectiveEntitlements => {
  const assignedPlan = subject.subscriptionPlan;
  const active = isPlanUsable(subject, now);
  const effectivePlan = active ? assignedPlan : "free";
  const plan = PLAN_DEFINITIONS[effectivePlan];
  const limitsPending = plan.limits.portfolios.status === "pending" || plan.limits.assetsPerPortfolio.status === "pending";
  const conservative = PLAN_DEFINITIONS.free.limits;

  return {
    assignedPlan,
    effectivePlan,
    isExpired: assignedPlan !== "free" && !active,
    role: subject.role,
    testerAccess: subject.testerAccess,
    limits: {
      portfolios: plan.limits.portfolios.status === "confirmed"
        ? plan.limits.portfolios.value
        : conservative.portfolios.status === "confirmed" ? conservative.portfolios.value : null,
      assetsPerPortfolio: plan.limits.assetsPerPortfolio.status === "confirmed"
        ? plan.limits.assetsPerPortfolio.value
        : conservative.assetsPerPortfolio.status === "confirmed" ? conservative.assetsPerPortfolio.value : null,
      decisionsPending: limitsPending,
    },
    features: plan.features,
  };
};

export const canAccessFeature = (
  subject: EntitlementSubject,
  feature: EntitlementFeature,
  now = Date.now()
) => {
  if (feature === "espi") {
    return subject.role === "admin" || subject.espiAccess || isPublicEspiReadEnabled();
  }
  if (subject.testerAccess) return true;
  return resolveEffectiveEntitlements(subject, now).features[feature] === "included";
};

export const canCreatePortfolio = (
  subject: EntitlementSubject,
  currentPortfolioCount: number,
  now = Date.now()
) => {
  if (subject.testerAccess) return true;
  const limit = resolveEffectiveEntitlements(subject, now).limits.portfolios;
  return limit === null || currentPortfolioCount < limit;
};

export const canAddAsset = (
  subject: EntitlementSubject,
  currentAssetCount: number,
  now = Date.now()
) => {
  if (subject.testerAccess) return true;
  const limit = resolveEffectiveEntitlements(subject, now).limits.assetsPerPortfolio;
  return limit === null || currentAssetCount < limit;
};

export const isSubscriptionPlan = (value: unknown): value is SubscriptionPlan =>
  typeof value === "string" && SUBSCRIPTION_PLAN_IDS.includes(value as SubscriptionPlan);
