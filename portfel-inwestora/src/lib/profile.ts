import { getTodayDateInputValue, round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type {
  UserProfile,
  WealthAssetCategory,
  WealthCategory,
  WealthItem,
  WealthItemKind,
  WealthLiabilityCategory,
} from "@/types/portfolio";

const WEALTH_ASSET_CATEGORIES = new Set<WealthAssetCategory>([
  "house",
  "apartment",
  "land",
  "car",
  "motorcycle",
  "gold",
  "art",
  "collection",
  "deposit",
  "other",
]);

const WEALTH_LIABILITY_CATEGORIES = new Set<WealthLiabilityCategory>([
  "mortgage",
  "car-loan",
  "loan",
  "other-liability",
]);

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const toFiniteNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeWealthKind = (value: unknown): WealthItemKind =>
  value === "liability" ? "liability" : "asset";

const normalizeWealthCategory = (
  value: unknown,
  kind: WealthItemKind
): WealthCategory => {
  if (typeof value === "string") {
    if (kind === "asset" && WEALTH_ASSET_CATEGORIES.has(value as WealthAssetCategory)) {
      return value as WealthAssetCategory;
    }

    if (
      kind === "liability" &&
      WEALTH_LIABILITY_CATEGORIES.has(value as WealthLiabilityCategory)
    ) {
      return value as WealthLiabilityCategory;
    }
  }

  return kind === "asset" ? "other" : "other-liability";
};

const normalizeDate = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Deposit terms, or undefined when anything essential is missing. */
const normalizeWealthDeposit = (value: unknown): WealthItem["deposit"] => {
  const raw = toRecord(value);
  const principal = toFiniteNumber(raw.principal, 0);
  const startDate = normalizeDate(raw.startDate);
  const termMonths = Math.round(toFiniteNumber(raw.termMonths, 0));
  if (!value || principal <= 0 || !startDate || termMonths < 1) return undefined;
  return {
    principal: round(principal, 2),
    startDate,
    termMonths: clamp(termMonths, 1, 600),
    annualRatePercent: round(clamp(toFiniteNumber(raw.annualRatePercent, 0), 0, 100), 4),
    capitalization: raw.capitalization === "monthly" || raw.capitalization === "quarterly" ? raw.capitalization : "maturity",
    taxed: raw.taxed !== false,
  };
};

/** Loan terms, or undefined when anything essential is missing. */
const normalizeWealthLoan = (value: unknown): WealthItem["loan"] => {
  const raw = toRecord(value);
  const principal = toFiniteNumber(raw.principal, 0);
  const startDate = normalizeDate(raw.startDate);
  const termMonths = Math.round(toFiniteNumber(raw.termMonths, 0));
  if (!value || principal <= 0 || !startDate || termMonths < 1) return undefined;
  return {
    principal: round(principal, 2),
    startDate,
    termMonths: clamp(termMonths, 1, 600),
    annualRatePercent: round(clamp(toFiniteNumber(raw.annualRatePercent, 0), 0, 100), 4),
    installment: raw.installment === "decreasing" ? "decreasing" : "equal",
  };
};

const normalizeWealthItems = (value: unknown, now: string): WealthItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): WealthItem | null => {
      const rawItem = toRecord(item);
      const name = typeof rawItem.name === "string" ? rawItem.name.trim() : "";

      if (!name) {
        return null;
      }

      const kind = normalizeWealthKind(rawItem.kind);
      const rawAnnualChange = toFiniteNumber(rawItem.annualChangePercent, 0);

      return {
        id:
          typeof rawItem.id === "string" && rawItem.id.trim()
            ? rawItem.id.trim()
            : `wealth-${index}`,
        kind,
        name: name.slice(0, 96),
        category: normalizeWealthCategory(rawItem.category, kind),
        value: round(Math.max(0, toFiniteNumber(rawItem.value, 0)), 2),
        currency: toCurrencyCode(
          typeof rawItem.currency === "string" ? rawItem.currency : undefined,
          "PLN"
        ),
        addedAt: toDateInputValue(
          typeof rawItem.addedAt === "string" ? rawItem.addedAt : undefined,
          getTodayDateInputValue()
        ),
        description:
          typeof rawItem.description === "string"
            ? rawItem.description.trim().slice(0, 360)
            : "",
        annualChangePercent: round(Math.max(-100, Math.min(1000, rawAnnualChange)), 2),
        ...(kind === "asset" && normalizeWealthDeposit(rawItem.deposit) ? { deposit: normalizeWealthDeposit(rawItem.deposit) } : {}),
        ...(kind === "liability" && normalizeWealthLoan(rawItem.loan) ? { loan: normalizeWealthLoan(rawItem.loan) } : {}),
        createdAt:
          typeof rawItem.createdAt === "string" && rawItem.createdAt
            ? rawItem.createdAt
            : now,
        updatedAt:
          typeof rawItem.updatedAt === "string" && rawItem.updatedAt
            ? rawItem.updatedAt
            : now,
      };
    })
    .filter((item): item is WealthItem => Boolean(item));
};

export const createFreshUserProfile = (
  fallback?: Partial<Pick<UserProfile, "displayName" | "email">>
): UserProfile => {
  const timestamp = new Date().toISOString();

  return {
    displayName: fallback?.displayName?.trim() ?? "",
    email: fallback?.email?.trim().toLowerCase() ?? "",
    country: "Polska",
    preferredBroker: "",
    experienceLevel: "beginner",
    monthlyContributionPln: 0,
    investmentGoal: "Długoterminowe budowanie kapitału",
    wealthItems: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createEmptyUserProfile = (): UserProfile => ({
  ...createFreshUserProfile(),
  createdAt: "",
  updatedAt: "",
});

/** Stable identity for profile persistence; a timestamp-only change is not a user edit. */
export const getUserProfilePersistenceFingerprint = (profile: UserProfile) => {
  const persistedFields = Object.fromEntries(
    Object.entries(profile).filter(([key]) => key !== "updatedAt")
  );
  return JSON.stringify(persistedFields);
};

export const normalizeUserProfile = (
  value: Partial<UserProfile> | null | undefined,
  fallback?: Partial<UserProfile>
): UserProfile => {
  const freshProfile = createFreshUserProfile({
    displayName: fallback?.displayName,
    email: fallback?.email,
  });

  return {
    ...freshProfile,
    ...fallback,
    displayName:
      typeof value?.displayName === "string"
        ? value.displayName.trim()
        : (fallback?.displayName ?? freshProfile.displayName),
    email:
      typeof value?.email === "string"
        ? value.email.trim().toLowerCase()
        : (fallback?.email ?? freshProfile.email),
    country:
      typeof value?.country === "string" && value.country.trim()
        ? value.country.trim()
        : (fallback?.country ?? "Polska"),
    preferredBroker:
      typeof value?.preferredBroker === "string" ? value.preferredBroker.trim() : "",
    experienceLevel:
      value?.experienceLevel === "intermediate" || value?.experienceLevel === "advanced"
        ? value.experienceLevel
        : (fallback?.experienceLevel ?? "beginner"),
    monthlyContributionPln:
      typeof value?.monthlyContributionPln === "number" &&
      Number.isFinite(value.monthlyContributionPln)
        ? value.monthlyContributionPln
        : (fallback?.monthlyContributionPln ?? 0),
    investmentGoal:
      typeof value?.investmentGoal === "string" && value.investmentGoal.trim()
        ? value.investmentGoal.trim()
        : (fallback?.investmentGoal ?? "Długoterminowe budowanie kapitału"),
    wealthItems: normalizeWealthItems(value?.wealthItems ?? fallback?.wealthItems, freshProfile.updatedAt),
    createdAt:
      typeof value?.createdAt === "string" && value.createdAt
        ? value.createdAt
        : (fallback?.createdAt ?? freshProfile.createdAt),
    updatedAt:
      typeof value?.updatedAt === "string" && value.updatedAt
        ? value.updatedAt
        : (fallback?.updatedAt ?? freshProfile.updatedAt),
  };
};

export const getUserInitials = (profile: UserProfile) => {
  const source = profile.displayName.trim() || profile.email.trim() || "PI";
  const normalized = source.replace(/@.*$/, "");

  return (
    normalized
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "PI"
  );
};

export const getUserProfileCompletion = (profile: UserProfile) => {
  const checks = [
    profile.displayName.trim().length > 0,
    profile.email.trim().length > 0,
    profile.country.trim().length > 0,
    profile.preferredBroker.trim().length > 0,
    profile.monthlyContributionPln > 0,
    profile.investmentGoal.trim().length > 0,
  ];

  const completed = checks.filter(Boolean).length;
  const total = checks.length;

  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100),
  };
};
