import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FREE_PLAN_ASSET_LIMIT } from "@/lib/constants";
import { normalizePortfolioBook, normalizePortfolioState } from "@/lib/portfolio-state";
import type { NextResponse } from "next/server";
import { createFreshUserProfile, normalizeUserProfile } from "@/lib/profile";
import { isForcedProEmail } from "@/lib/server/access";
import { execute, queryOne } from "@/lib/server/db";
import { sendVerificationEmail } from "@/lib/server/email";
import type {
  AuthenticatedUser,
  PortfolioBook,
  PortfolioState,
  SubscriptionPlan,
  SubscriptionStatus,
  UserProfile,
} from "@/types/portfolio";

const SESSION_COOKIE_NAME = "portfel_inwestora_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const EMAIL_VERIFICATION_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const PASSWORD_RESET_MAX_AGE_MS = 1000 * 60 * 60 * 2;

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  email_verified_at: string | null;
  subscription_plan: string;
  subscription_status: string;
  subscription_updated_at: string | null;
  profile_json: string;
  portfolio_json: string;
  created_at: string;
  updated_at: string;
};

type SessionUserRow = UserRow & {
  expires_at: string;
};

type TokenRow = {
  user_id: string;
  expires_at: string;
};

export class EmailVerificationRequiredError extends Error {
  userId: string;

  constructor(userId: string) {
    super("Potwierdz adres email przed logowaniem.");
    this.name = "EmailVerificationRequiredError";
    this.userId = userId;
  }
}

const getSessionExpiry = () => new Date(Date.now() + SESSION_MAX_AGE_MS);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createRawToken = () => randomBytes(32).toString("hex");

const isEmailValid = (email: string) => /^\S+@\S+\.\S+$/.test(email);

const normalizeSubscriptionPlan = (plan: string | null | undefined): SubscriptionPlan =>
  plan === "pro" ? "pro" : "free";

const normalizeSubscriptionStatus = (
  status: string | null | undefined
): SubscriptionStatus => {
  if (
    status === "trialing" ||
    status === "past_due" ||
    status === "canceled"
  ) {
    return status;
  }

  return "active";
};

export const canUseProFeatures = (user: Pick<AuthenticatedUser, "subscriptionPlan" | "subscriptionStatus">) =>
  user.subscriptionPlan === "pro" &&
  (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing");

const toAuthenticatedUser = (
  user: Pick<
    UserRow,
    | "id"
    | "email"
    | "display_name"
    | "created_at"
    | "email_verified_at"
    | "subscription_plan"
    | "subscription_status"
  >
): AuthenticatedUser => ({
  id: user.id,
  email: user.email,
  displayName: user.display_name,
  createdAt: user.created_at,
  emailVerifiedAt: user.email_verified_at,
  subscriptionPlan: normalizeSubscriptionPlan(user.subscription_plan),
  subscriptionStatus: normalizeSubscriptionStatus(user.subscription_status),
});

const parsePortfolioBook = (portfolioJson: string): PortfolioBook => {
  try {
    return normalizePortfolioBook(JSON.parse(portfolioJson));
  } catch {
    return normalizePortfolioBook([]);
  }
};

const parseUserProfile = (
  user: Pick<
    UserRow,
    "display_name" | "email" | "created_at" | "updated_at" | "profile_json"
  >
): UserProfile => {
  const fallbackProfile = {
    ...createFreshUserProfile({
      displayName: user.display_name,
      email: user.email,
    }),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };

  try {
    return normalizeUserProfile(
      JSON.parse(user.profile_json) as Partial<UserProfile>,
      fallbackProfile
    );
  } catch {
    return fallbackProfile;
  }
};

const getUserByEmail = (email: string) =>
  queryOne<UserRow>("SELECT * FROM users WHERE email = $1", [email]);

const getUserById = (id: string) =>
  queryOne<UserRow>("SELECT * FROM users WHERE id = $1", [id]);

const getSessionUser = (token: string) =>
  queryOne<SessionUserRow>(
    `
      SELECT users.*, sessions.expires_at
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1
    `,
    [hashToken(token)]
  );

const getTokenTableName = (
  tableName: "email_verification_tokens" | "password_reset_tokens"
) => tableName;

const getTokenRow = (
  tableName: "email_verification_tokens" | "password_reset_tokens",
  token: string
) =>
  queryOne<TokenRow>(
    `SELECT user_id, expires_at FROM ${getTokenTableName(tableName)} WHERE token_hash = $1`,
    [hashToken(token)]
  );

const withForcedProSubscription = async <T extends UserRow>(user: T): Promise<T> => {
  if (!isForcedProEmail(user.email)) {
    return user;
  }

  if (user.subscription_plan === "pro" && user.subscription_status === "active") {
    return user;
  }

  const now = new Date().toISOString();

  await execute(
    `
      UPDATE users
      SET subscription_plan = $1, subscription_status = $2, subscription_updated_at = $3, updated_at = $4
      WHERE id = $5
    `,
    ["pro", "active", now, now, user.id]
  );

  return {
    ...user,
    subscription_plan: "pro",
    subscription_status: "active",
    subscription_updated_at: now,
    updated_at: now,
  };
};

const removeSessionByToken = async (token: string) => {
  await execute("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
};

const removeSessionsByUserId = async (userId: string) => {
  await execute("DELETE FROM sessions WHERE user_id = $1", [userId]);
};

const purgeTokensForUser = (
  tableName: "email_verification_tokens" | "password_reset_tokens",
  userId: string
) => {
  return execute(`DELETE FROM ${getTokenTableName(tableName)} WHERE user_id = $1`, [userId]);
};

const createStoredToken = async (
  tableName: "email_verification_tokens" | "password_reset_tokens",
  userId: string,
  maxAgeMs: number
) => {
  const token = createRawToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();

  await execute(
    `
      INSERT INTO ${getTokenTableName(tableName)} (id, user_id, token_hash, created_at, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [randomUUID(), userId, hashToken(token), now, expiresAt]
  );

  return {
    token,
    expiresAt,
  };
};

export const appendSessionCookie = (
  response: NextResponse,
  token: string,
  expiresAt: Date
) => {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
};

export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
};

export const createSessionForUser = async (userId: string) => {
  const rawToken = createRawToken();
  const now = new Date().toISOString();
  const expiresAt = getSessionExpiry();

  await execute(
    `
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [randomUUID(), userId, hashToken(rawToken), now, expiresAt.toISOString()]
  );

  return {
    token: rawToken,
    expiresAt,
  };
};

export const registerAccount = async ({
  displayName,
  email,
  password,
}: {
  displayName: string;
  email: string;
  password: string;
}) => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = displayName.trim();

  if (!normalizedName || normalizedName.length < 2) {
    throw new Error("Podaj nazwe uzytkownika zlozona z co najmniej 2 znakow.");
  }

  if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Podaj poprawny adres email.");
  }

  if (password.length < 8) {
    throw new Error("Haslo musi miec co najmniej 8 znakow.");
  }

  if (await getUserByEmail(normalizedEmail)) {
    throw new Error("Konto z tym adresem email juz istnieje.");
  }

  const now = new Date().toISOString();
  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const profile = {
    ...createFreshUserProfile({
      displayName: normalizedName,
      email: normalizedEmail,
    }),
    createdAt: now,
    updatedAt: now,
  };

  const initialSubscriptionPlan = isForcedProEmail(normalizedEmail) ? "pro" : "free";

  await execute(
    `
      INSERT INTO users (
        id,
        email,
        password_hash,
        display_name,
        email_verified_at,
        subscription_plan,
        subscription_status,
        subscription_updated_at,
        profile_json,
        portfolio_json,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      userId,
      normalizedEmail,
      passwordHash,
      normalizedName,
      null,
      initialSubscriptionPlan,
      "active",
      now,
      JSON.stringify(profile),
      JSON.stringify({
        assets: [],
        sales: [],
        realizedAdjustments: [],
      }),
      now,
      now,
    ]
  );

  return {
    id: userId,
    email: normalizedEmail,
    displayName: normalizedName,
    createdAt: now,
    emailVerifiedAt: null,
    subscriptionPlan: initialSubscriptionPlan,
    subscriptionStatus: "active",
  } satisfies AuthenticatedUser;
};

export const upsertOAuthAccount = async ({
  email,
  displayName,
}: {
  email: string;
  displayName?: string | null;
}) => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = displayName?.trim() || normalizedEmail.split("@")[0] || "Uzytkownik";

  if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Dostawca logowania nie zwrocil poprawnego adresu email.");
  }

  const existingUser = await getUserByEmail(normalizedEmail);
  const now = new Date().toISOString();

  if (existingUser) {
    if (!existingUser.email_verified_at) {
      await execute(
        "UPDATE users SET email_verified_at = $1, updated_at = $2 WHERE id = $3",
        [now, now, existingUser.id]
      );
      await purgeTokensForUser("email_verification_tokens", existingUser.id);
    }

    const updatedUser = (await getUserById(existingUser.id)) ?? existingUser;
    return toAuthenticatedUser(await withForcedProSubscription(updatedUser));
  }

  const userId = randomUUID();
  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  const profile = {
    ...createFreshUserProfile({
      displayName: normalizedName,
      email: normalizedEmail,
    }),
    createdAt: now,
    updatedAt: now,
  };
  const initialSubscriptionPlan = isForcedProEmail(normalizedEmail) ? "pro" : "free";

  await execute(
    `
      INSERT INTO users (
        id,
        email,
        password_hash,
        display_name,
        email_verified_at,
        subscription_plan,
        subscription_status,
        subscription_updated_at,
        profile_json,
        portfolio_json,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      userId,
      normalizedEmail,
      passwordHash,
      normalizedName,
      now,
      initialSubscriptionPlan,
      "active",
      now,
      JSON.stringify(profile),
      JSON.stringify({
        assets: [],
        sales: [],
        realizedAdjustments: [],
      }),
      now,
      now,
    ]
  );

  const createdUser = await getUserById(userId);

  if (!createdUser) {
    throw new Error("Nie udalo sie utworzyc konta przez logowanie zewnetrzne.");
  }

  return toAuthenticatedUser(await withForcedProSubscription(createdUser));
};

export const loginAccount = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await getUserByEmail(normalizedEmail);

  if (!user) {
    throw new Error("Nie znaleziono konta z tym adresem email.");
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    throw new Error("Niepoprawny email lub haslo.");
  }

  if (!user.email_verified_at) {
    throw new EmailVerificationRequiredError(user.id);
  }

  return toAuthenticatedUser(await withForcedProSubscription(user));
};

export const getCurrentAccountData = async () => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) return null;

  const sessionUser = await getSessionUser(sessionToken);

  if (!sessionUser) return null;

  if (new Date(sessionUser.expires_at).getTime() <= Date.now()) {
    await removeSessionByToken(sessionToken);
    return null;
  }

  const user = await withForcedProSubscription(sessionUser);
  const portfolioBook = parsePortfolioBook(user.portfolio_json);

  return {
    user: toAuthenticatedUser(user),
    profile: parseUserProfile(user),
    ...normalizePortfolioState(portfolioBook),
    ...portfolioBook,
  };
};

export const requireCurrentAccountData = async () => {
  const accountData = await getCurrentAccountData();
  if (!accountData) redirect("/login");
  return accountData;
};

export const updateCurrentUserProfile = async (
  userId: string,
  nextProfile: UserProfile
) => {
  const existingUser = await getUserById(userId);

  if (!existingUser) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  const normalizedProfile = normalizeUserProfile(nextProfile, {
    displayName: existingUser.display_name,
    email: existingUser.email,
    createdAt: existingUser.created_at,
    updatedAt: new Date().toISOString(),
  });

  if (!normalizedProfile.displayName || normalizedProfile.displayName.length < 2) {
    throw new Error("Nazwa uzytkownika musi miec co najmniej 2 znaki.");
  }

  if (!normalizedProfile.email || !isEmailValid(normalizedProfile.email)) {
    throw new Error("Podaj poprawny adres email.");
  }

  const sameEmailUser = await getUserByEmail(normalizedProfile.email);
  if (sameEmailUser && sameEmailUser.id !== userId) {
    throw new Error("Ten adres email jest juz zajety.");
  }

  const now = new Date().toISOString();
  const emailChanged = normalizedProfile.email !== existingUser.email;
  const nextEmailVerifiedAt = emailChanged ? null : existingUser.email_verified_at;

  if (emailChanged) {
    await purgeTokensForUser("email_verification_tokens", userId);
  }

  await execute(
    `
      UPDATE users
      SET email = $1, display_name = $2, email_verified_at = $3, profile_json = $4, updated_at = $5
      WHERE id = $6
    `,
    [
      normalizedProfile.email,
      normalizedProfile.displayName,
      nextEmailVerifiedAt,
      JSON.stringify({
        ...normalizedProfile,
        updatedAt: now,
      }),
      now,
      userId,
    ]
  );

  const updatedUser = await getUserById(userId);

  if (!updatedUser) {
    throw new Error("Nie udalo sie zapisac profilu.");
  }

  return {
    user: toAuthenticatedUser(updatedUser),
    profile: parseUserProfile(updatedUser),
  };
};

export const updateCurrentUserPortfolio = async (
  userId: string,
  portfolio: PortfolioState | PortfolioBook
) => {
  const existingUser = await getUserById(userId);

  if (!existingUser) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  const account = toAuthenticatedUser(await withForcedProSubscription(existingUser));
  const normalizedPortfolio = normalizePortfolioBook(portfolio);
  const aggregatedPortfolio = normalizePortfolioState(normalizedPortfolio);

  const hasPortfolioOverFreeLimit = normalizedPortfolio.portfolios.some(
    (item) => item.assets.length > FREE_PLAN_ASSET_LIMIT
  );

  if (!canUseProFeatures(account) && hasPortfolioOverFreeLimit) {
    throw new Error(
      `Plan Free pozwala zapisac do ${FREE_PLAN_ASSET_LIMIT} pozycji. Przejdz na Pro, aby dodawac kolejne.`
    );
  }

  await execute(
    `
      UPDATE users
      SET portfolio_json = $1, updated_at = $2
      WHERE id = $3
    `,
    [JSON.stringify(normalizedPortfolio), new Date().toISOString(), userId]
  );

  return {
    ...aggregatedPortfolio,
    ...normalizedPortfolio,
  };
};

export const updateCurrentUserSubscription = async (
  userId: string,
  plan: SubscriptionPlan
) => {
  const existingUser = await getUserById(userId);

  if (!existingUser) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  const now = new Date().toISOString();
  const nextPlan = isForcedProEmail(existingUser.email) ? "pro" : plan;

  await execute(
    `
      UPDATE users
      SET subscription_plan = $1, subscription_status = $2, subscription_updated_at = $3, updated_at = $4
      WHERE id = $5
    `,
    [nextPlan, "active", now, now, userId]
  );

  const updatedUser = await getUserById(userId);

  if (!updatedUser) {
    throw new Error("Nie udalo sie zapisac planu.");
  }

  return toAuthenticatedUser(await withForcedProSubscription(updatedUser));
};

export const deleteUserByAdmin = async (adminUserId: string, targetUserId: string) => {
  const [adminUser, targetUser] = await Promise.all([
    getUserById(adminUserId),
    getUserById(targetUserId),
  ]);

  if (!adminUser || !targetUser) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  if (adminUser.id === targetUser.id) {
    throw new Error("Nie mozesz usunac wlasnego konta admina.");
  }

  await execute("DELETE FROM users WHERE id = $1", [targetUser.id]);
};

export const requestEmailVerificationForUser = async (userId: string, baseUrl: string) => {
  const user = await getUserById(userId);

  if (!user) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  if (user.email_verified_at) {
    return {
      previewUrl: null,
      alreadyVerified: true,
    };
  }

  await purgeTokensForUser("email_verification_tokens", userId);

  const verification = await createStoredToken(
    "email_verification_tokens",
    userId,
    EMAIL_VERIFICATION_MAX_AGE_MS
  );

  return {
    previewUrl: `${baseUrl}/verify-email?token=${verification.token}`,
    alreadyVerified: false,
  };
};

export const sendEmailVerificationForUser = async (userId: string, baseUrl: string) => {
  const result = await requestEmailVerificationForUser(userId, baseUrl);
  const user = await getUserById(userId);

  if (!user || result.alreadyVerified || !result.previewUrl) {
    return {
      ...result,
      sent: false,
    };
  }

  const emailResult = await sendVerificationEmail(user.email, result.previewUrl);

  return {
    ...result,
    sent: emailResult.sent,
  };
};

export const verifyEmailToken = async (token: string) => {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new Error("Brakuje tokenu weryfikacyjnego.");
  }

  const tokenRow = await getTokenRow("email_verification_tokens", normalizedToken);

  if (!tokenRow) {
    throw new Error("Link weryfikacyjny jest niepoprawny albo juz wygasl.");
  }

  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    await purgeTokensForUser("email_verification_tokens", tokenRow.user_id);
    throw new Error("Link weryfikacyjny wygasl. Wyslij nowy z panelu konta.");
  }

  const user = await getUserById(tokenRow.user_id);

  if (!user) {
    await purgeTokensForUser("email_verification_tokens", tokenRow.user_id);
    throw new Error("Nie znaleziono konta dla tego linku.");
  }

  const verifiedAt = new Date().toISOString();

  await execute(
    "UPDATE users SET email_verified_at = $1, updated_at = $2 WHERE id = $3",
    [verifiedAt, verifiedAt, user.id]
  );

  await purgeTokensForUser("email_verification_tokens", user.id);

  const updatedUser = await getUserById(user.id);

  if (!updatedUser) {
    throw new Error("Nie udalo sie potwierdzic adresu email.");
  }

  return toAuthenticatedUser(updatedUser);
};

export const requestPasswordResetForEmail = async (email: string, baseUrl: string) => {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Podaj poprawny adres email.");
  }

  const user = await getUserByEmail(normalizedEmail);

  if (!user) {
    return {
      previewUrl: null,
    };
  }

  await purgeTokensForUser("password_reset_tokens", user.id);

  const reset = await createStoredToken(
    "password_reset_tokens",
    user.id,
    PASSWORD_RESET_MAX_AGE_MS
  );

  return {
    previewUrl: `${baseUrl}/reset-password?token=${reset.token}`,
  };
};

export const resetPasswordWithToken = async (token: string, password: string) => {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new Error("Brakuje tokenu resetu hasla.");
  }

  if (password.length < 8) {
    throw new Error("Nowe haslo musi miec co najmniej 8 znakow.");
  }

  const tokenRow = await getTokenRow("password_reset_tokens", normalizedToken);

  if (!tokenRow) {
    throw new Error("Link do resetu hasla jest niepoprawny albo juz wygasl.");
  }

  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    await purgeTokensForUser("password_reset_tokens", tokenRow.user_id);
    throw new Error("Link do resetu hasla wygasl. Popros o nowy.");
  }

  const user = await getUserById(tokenRow.user_id);

  if (!user) {
    await purgeTokensForUser("password_reset_tokens", tokenRow.user_id);
    throw new Error("Nie znaleziono konta dla tego linku.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();

  await execute(
    "UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3",
    [passwordHash, now, user.id]
  );

  await purgeTokensForUser("password_reset_tokens", user.id);
  await removeSessionsByUserId(user.id);
};

export const logoutCurrentSession = async () => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken) {
    await removeSessionByToken(sessionToken);
  }
};
