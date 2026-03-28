import type { UserProfile } from "@/types/portfolio";

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
    investmentGoal: "Dlugoterminowe budowanie kapitalu",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createEmptyUserProfile = (): UserProfile => ({
  ...createFreshUserProfile(),
  createdAt: "",
  updatedAt: "",
});

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
        : (fallback?.investmentGoal ?? "Dlugoterminowe budowanie kapitalu"),
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
