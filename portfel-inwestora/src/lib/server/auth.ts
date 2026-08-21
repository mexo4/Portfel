import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FREE_PLAN_ASSET_LIMIT, MEXO_TESTER_MODE } from "@/lib/constants";
import { assertUniquePortfolioNames, normalizePortfolioBook, normalizePortfolioState } from "@/lib/portfolio-state";
import type { NextResponse } from "next/server";
import { createFreshUserProfile, normalizeUserProfile } from "@/lib/profile";
import { isForcedProEmail } from "@/lib/server/access";
import { execute, queryOne, withTransaction } from "@/lib/server/db";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/server/email";
import { syncPortfolioCoreTablesInTransaction } from "@/lib/server/portfolio-core-sync";
import {
  getPortfolioQuoteSnapshots,
  mergePortfolioBookQuoteSnapshots,
} from "@/lib/server/portfolio-quote-snapshots";
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
  password_hash: string | null;
  display_name: string;
  email_verified_at: string | null;
  subscription_plan: string;
  subscription_status: string;
  subscription_updated_at: string | null;
  profile_json: string;
  portfolio_json: string;
  portfolio_revision: number;
  portfolio_core_revision: number;
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

type PortfolioJsonRow = {
  portfolio_json: string;
  portfolio_revision: number;
};

export class EmailVerificationRequiredError extends Error {
  userId: string;

  constructor(userId: string) {
    super("Potwierdz adres email przed logowaniem.");
    this.name = "EmailVerificationRequiredError";
    this.userId = userId;
  }
}

export class PortfolioRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("Dane portfela zostaly zmienione w innej sesji. Odswiezono aktualny stan.");
    this.name = "PortfolioRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

const getSessionExpiry = () => new Date(Date.now() + SESSION_MAX_AGE_MS);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createRawToken = () => randomBytes(32).toString("hex");

const isEmailValid = (email: string) => /^\S+@\S+\.\S+$/.test(email);

const normalizeEmail = (email: string) => email.trim().toLowerCase();

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
  MEXO_TESTER_MODE || (user.subscriptionPlan === "pro" &&
  (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing"));

const toAuthenticatedUser = (
  user: Pick<
    UserRow,
    | "id"
    | "email"
    | "display_name"
    | "created_at"
    | "email_verified_at"
    | "password_hash"
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
  hasPassword: Boolean(user.password_hash),
});

const hasPortfolioV2Shape = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const rawBook = value as { schemaVersion?: unknown; portfolios?: unknown[] };

  return (
    rawBook.schemaVersion === 2 &&
    Array.isArray(rawBook.portfolios) &&
    rawBook.portfolios.every((portfolio) => {
      if (!portfolio || typeof portfolio !== "object" || Array.isArray(portfolio)) {
        return false;
      }

      const rawPortfolio = portfolio as {
        schemaVersion?: unknown;
        accounts?: unknown;
        instruments?: unknown;
        operations?: unknown;
      };

      return (
        rawPortfolio.schemaVersion === 2 &&
        Array.isArray(rawPortfolio.accounts) &&
        Array.isArray(rawPortfolio.instruments) &&
        Array.isArray(rawPortfolio.operations)
      );
    })
  );
};

const parsePortfolioBook = (portfolioJson: string): {
  portfolioBook: PortfolioBook;
  needsMigration: boolean;
} => {
  try {
    const rawPortfolio = JSON.parse(portfolioJson);

    return {
      portfolioBook: normalizePortfolioBook(rawPortfolio),
      needsMigration: !hasPortfolioV2Shape(rawPortfolio),
    };
  } catch {
    return {
      portfolioBook: normalizePortfolioBook([]),
      needsMigration: true,
    };
  }
};

const getStoredPortfolioBook = async (userId: string) => {
  const row = await queryOne<PortfolioJsonRow>(
    "SELECT portfolio_json, portfolio_revision FROM users WHERE id = $1",
    [userId]
  );
  const parsedPortfolioBook = parsePortfolioBook(row?.portfolio_json ?? "");

  return {
    ...parsedPortfolioBook,
    portfolioRevision: row?.portfolio_revision ?? 0,
  };
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

const userColumnsWithoutPortfolio = `
  id,
  email,
  password_hash,
  display_name,
  email_verified_at,
  subscription_plan,
  subscription_status,
  subscription_updated_at,
  profile_json,
  portfolio_revision,
  portfolio_core_revision,
  created_at,
  updated_at
`;
const sessionUserColumnsWithoutPortfolio = userColumnsWithoutPortfolio
  .split(",")
  .map((column) => `users.${column.trim()}`)
  .join(", ");

const getUserByEmail = (email: string) =>
  queryOne<UserRow>(
    `SELECT ${userColumnsWithoutPortfolio}, '' AS portfolio_json FROM users WHERE email = $1`,
    [email]
  );

const getUserById = (id: string) =>
  queryOne<UserRow>(
    `SELECT ${userColumnsWithoutPortfolio}, '' AS portfolio_json FROM users WHERE id = $1`,
    [id]
  );

const getUserByProviderAccount = (provider: string, providerAccountId: string) =>
  queryOne<UserRow>(
    `
      SELECT ${sessionUserColumnsWithoutPortfolio}, '' AS portfolio_json
      FROM auth_accounts
      INNER JOIN users ON users.id = auth_accounts.user_id
      WHERE auth_accounts.provider = $1 AND auth_accounts.provider_account_id = $2
    `,
    [provider, providerAccountId]
  );

const getSessionUser = (token: string) =>
  queryOne<SessionUserRow>(
    `
      SELECT ${sessionUserColumnsWithoutPortfolio},
        '' AS portfolio_json,
        sessions.expires_at
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

const AUTH_RETENTION_INTERVAL_MS = 1000 * 60 * 60 * 12;
let lastAuthRetentionAt = 0;

const scheduleExpiredAuthRecordCleanup = () => {
  const now = Date.now();
  if (now - lastAuthRetentionAt < AUTH_RETENTION_INTERVAL_MS) {
    return;
  }

  lastAuthRetentionAt = now;
  const cutoff = new Date(now).toISOString();
  // Opportunistic and cooldown-protected: this is never a dashboard-load
  // maintenance query. Only records that are already expired are removed.
  void Promise.all([
    execute("DELETE FROM sessions WHERE expires_at <= $1", [cutoff]),
    execute("DELETE FROM email_verification_tokens WHERE expires_at <= $1", [cutoff]),
    execute("DELETE FROM password_reset_tokens WHERE expires_at <= $1", [cutoff]),
  ]).catch(() => {
    lastAuthRetentionAt = 0;
  });
};

const getCurrentSessionUser = async () => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) return null;

  const sessionUser = await getSessionUser(sessionToken);

  if (!sessionUser) return null;

  if (new Date(sessionUser.expires_at).getTime() <= Date.now()) {
    await removeSessionByToken(sessionToken);
    return null;
  }

  scheduleExpiredAuthRecordCleanup();
  return sessionUser;
};

/**
 * Auth-only endpoints must not deserialize a user's complete portfolio just
 * to validate the session.  Keep this separate from getCurrentAccountData,
 * which intentionally loads the portfolio read model.
 */
export const getCurrentAuthenticatedUser = async () => {
  const sessionUser = await getCurrentSessionUser();
  return sessionUser ? toAuthenticatedUser(await withForcedProSubscription(sessionUser)) : null;
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
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = displayName.trim();

  if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Podaj poprawny adres email.");
  }

  const existingUser = await getUserByEmail(normalizedEmail);

  if (existingUser) {
    if (existingUser.email_verified_at) {
      throw new Error("Konto z tym adresem email juz istnieje.");
    }

    return toAuthenticatedUser(await withForcedProSubscription(existingUser));
  }

  if (!normalizedName || normalizedName.length < 2) {
    throw new Error("Podaj nazwe uzytkownika zlozona z co najmniej 2 znakow.");
  }

  if (password.length < 8) {
    throw new Error("Haslo musi miec co najmniej 8 znakow.");
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
  const initialPortfolioBook = normalizePortfolioBook({
    assets: [],
    sales: [],
    realizedAdjustments: [],
  });

  await withTransaction(async (transaction) => {
    await transaction.execute(
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
        JSON.stringify(initialPortfolioBook),
        now,
        now,
      ]
    );
    await syncPortfolioCoreTablesInTransaction(transaction, userId, initialPortfolioBook);
    await transaction.execute(
      "UPDATE users SET portfolio_core_revision = portfolio_revision WHERE id = $1",
      [userId]
    );
  });

  return {
    id: userId,
    email: normalizedEmail,
    displayName: normalizedName,
    createdAt: now,
    emailVerifiedAt: null,
    subscriptionPlan: initialSubscriptionPlan,
    subscriptionStatus: "active",
    hasPassword: true,
  } satisfies AuthenticatedUser;
};

export const resolveGoogleOAuthAccount = async ({
  providerAccountId,
  email,
  displayName,
  emailVerified,
}: {
  providerAccountId: string;
  email: string;
  displayName?: string | null;
  emailVerified: boolean;
}) => {
  const provider = "google";
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = displayName?.trim() || normalizedEmail.split("@")[0] || "Uzytkownik";

  if (!providerAccountId || !normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Dostawca logowania nie zwrocil poprawnej tozsamosci.");
  }

  if (!emailVerified) {
    throw new Error("Konto Google nie ma potwierdzonego adresu email.");
  }

  const resolvedUserId = await withTransaction(async (transaction) => {
    // Serializujemy laczenie kont po trwalym identyfikatorze Google i emailu.
    await transaction.query<{ locked: number }>(
      "SELECT pg_advisory_xact_lock(hashtext($1)) AS locked",
      [`oauth:${provider}:${providerAccountId}`]
    );
    await transaction.query<{ locked: number }>(
      "SELECT pg_advisory_xact_lock(hashtext($1)) AS locked",
      [`oauth-email:${normalizedEmail}`]
    );

    const mappedRows = await transaction.query<UserRow>(
      `
        SELECT ${sessionUserColumnsWithoutPortfolio}, '' AS portfolio_json
        FROM auth_accounts
        INNER JOIN users ON users.id = auth_accounts.user_id
        WHERE auth_accounts.provider = $1 AND auth_accounts.provider_account_id = $2
        FOR UPDATE
      `,
      [provider, providerAccountId]
    );
    const mappedUser = mappedRows[0];

    if (mappedUser) {
      return mappedUser.id;
    }

    const emailRows = await transaction.query<UserRow>(
      `SELECT ${userColumnsWithoutPortfolio}, '' AS portfolio_json FROM users WHERE email = $1 FOR UPDATE`,
      [normalizedEmail]
    );
    const existingUser = emailRows[0];
    const now = new Date().toISOString();

    if (existingUser) {
      if (!existingUser.email_verified_at) {
        await transaction.execute(
          "UPDATE users SET email_verified_at = $1, updated_at = $2 WHERE id = $3",
          [now, now, existingUser.id]
        );
        await transaction.execute("DELETE FROM email_verification_tokens WHERE user_id = $1", [
          existingUser.id,
        ]);
      }

      await transaction.execute(
        `
          INSERT INTO auth_accounts (
            id, user_id, provider, provider_account_id, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (provider, provider_account_id) DO NOTHING
        `,
        [randomUUID(), existingUser.id, provider, providerAccountId, now, now]
      );

      return existingUser.id;
    }

    const userId = randomUUID();
    const profile = {
      ...createFreshUserProfile({
        displayName: normalizedName,
        email: normalizedEmail,
      }),
      createdAt: now,
      updatedAt: now,
    };
    const initialSubscriptionPlan = isForcedProEmail(normalizedEmail) ? "pro" : "free";
    const initialPortfolioBook = normalizePortfolioBook({
      assets: [],
      sales: [],
      realizedAdjustments: [],
    });

    await transaction.execute(
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
        null,
        normalizedName,
        now,
        initialSubscriptionPlan,
        "active",
        now,
        JSON.stringify(profile),
        JSON.stringify(initialPortfolioBook),
        now,
        now,
      ]
    );
    await syncPortfolioCoreTablesInTransaction(transaction, userId, initialPortfolioBook);
    await transaction.execute(
      "UPDATE users SET portfolio_core_revision = portfolio_revision WHERE id = $1",
      [userId]
    );
    await transaction.execute(
      `
        INSERT INTO auth_accounts (
          id, user_id, provider, provider_account_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [randomUUID(), userId, provider, providerAccountId, now, now]
    );

    return userId;
  });

  const user =
    (await getUserByProviderAccount(provider, providerAccountId)) ??
    (await getUserById(resolvedUserId));

  if (!user) {
    throw new Error("Nie udalo sie polaczyc konta Google z kontem Mexo.");
  }

  return toAuthenticatedUser(await withForcedProSubscription(user));
};

export const loginAccount = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await getUserByEmail(normalizedEmail);

  if (!user) {
    throw new Error("Nie znaleziono konta z tym adresem email.");
  }

  if (!user.password_hash) {
    throw new Error(
      "To konto nie ma ustawionego hasla. Kontynuuj z Google albo ustaw haslo przez reset."
    );
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
  const sessionUser = await getCurrentSessionUser();

  if (!sessionUser) return null;

  const user = await withForcedProSubscription(sessionUser);
  const storedPortfolio = await getStoredPortfolioBook(user.id);
  let portfolioBook = storedPortfolio.portfolioBook;
  let portfolioRevision = storedPortfolio.portfolioRevision;

  if (
    storedPortfolio.needsMigration ||
    user.portfolio_core_revision !== portfolioRevision
  ) {
    const persistedPortfolio = await updateCurrentUserPortfolio(
      user.id,
      portfolioBook,
      portfolioRevision,
      { enforcePlanLimit: false }
    );
    portfolioBook = persistedPortfolio.portfolioBook;
    portfolioRevision = persistedPortfolio.portfolioRevision;
  }

  portfolioBook = mergePortfolioBookQuoteSnapshots(
    portfolioBook,
    await getPortfolioQuoteSnapshots(portfolioBook.portfolios.map((portfolio) => portfolio.id))
  );

  const activePortfolio =
    portfolioBook.portfolios.find(
      (portfolio) => portfolio.id === portfolioBook.activePortfolioId
    ) ?? portfolioBook.portfolios[0];

  return {
    user: toAuthenticatedUser(user),
    profile: parseUserProfile(user),
    portfolioRevision,
    ...normalizePortfolioState(activePortfolio),
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

  const normalizedEmail = normalizeEmail(normalizedProfile.email);

  if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Podaj poprawny adres email.");
  }

  const sameEmailUser = await getUserByEmail(normalizedEmail);
  if (sameEmailUser && sameEmailUser.id !== userId) {
    throw new Error("Ten adres email jest juz zajety.");
  }

  const now = new Date().toISOString();
  const emailChanged = normalizedEmail !== existingUser.email;
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
      normalizedEmail,
      normalizedProfile.displayName,
      nextEmailVerifiedAt,
      JSON.stringify({
        ...normalizedProfile,
        email: normalizedEmail,
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
  portfolio: PortfolioState | PortfolioBook,
  expectedPortfolioRevision?: number,
  options: { enforcePlanLimit?: boolean } = {}
) => {
  const existingUser = await getUserById(userId);

  if (!existingUser) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  const account = toAuthenticatedUser(await withForcedProSubscription(existingUser));
  const normalizedPortfolio = normalizePortfolioBook(portfolio);
  // Client-side feedback is helpful, but this is the authoritative guard for
  // every portfolio-book write, including concurrent tabs and API callers.
  assertUniquePortfolioNames(normalizedPortfolio.portfolios);

  const hasPortfolioOverFreeLimit = normalizedPortfolio.portfolios.some(
    (item) => item.assets.length > FREE_PLAN_ASSET_LIMIT
  );

  if (options.enforcePlanLimit !== false && !canUseProFeatures(account) && hasPortfolioOverFreeLimit) {
    throw new Error(
      `Plan Free pozwala zapisac do ${FREE_PLAN_ASSET_LIMIT} pozycji. Przejdz na Pro, aby dodawac kolejne.`
    );
  }

  const updatedAt = new Date().toISOString();
  const requestedRevision = Number.isInteger(expectedPortfolioRevision)
    ? expectedPortfolioRevision
    : existingUser.portfolio_revision;

  return withTransaction(async (transaction) => {
    const currentRows = await transaction.query<{
      portfolio_revision: number;
      portfolio_core_revision: number;
    }>(
      "SELECT portfolio_revision, portfolio_core_revision FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );
    const currentUser = currentRows[0];

    if (!currentUser) {
      throw new Error("Nie znaleziono uzytkownika.");
    }

    if (currentUser.portfolio_revision !== requestedRevision) {
      throw new PortfolioRevisionConflictError(currentUser.portfolio_revision);
    }

    const updatedRows = await transaction.query<{ portfolio_revision: number }>(
      `
        UPDATE users
        SET portfolio_json = $1,
          portfolio_revision = portfolio_revision + 1,
          updated_at = $2
        WHERE id = $3
        RETURNING portfolio_revision
      `,
      [JSON.stringify(normalizedPortfolio), updatedAt, userId]
    );
    const updatedUser = updatedRows[0];

    if (!updatedUser) {
      throw new Error("Nie udalo sie zapisac portfela.");
    }

    await syncPortfolioCoreTablesInTransaction(transaction, userId, normalizedPortfolio);
    await transaction.execute(
      "UPDATE users SET portfolio_core_revision = $1 WHERE id = $2",
      [updatedUser.portfolio_revision, userId]
    );

    return {
      portfolioBook: normalizedPortfolio,
      portfolioRevision: updatedUser.portfolio_revision,
    };
  });
};

export const updateCurrentUserSubscription = async (
  userId: string,
  plan: SubscriptionPlan
) => {
  const existingUser = await getUserById(userId);

  if (!existingUser) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  if (plan === "pro" && !isForcedProEmail(existingUser.email)) {
    throw new Error("Plan Pro wymaga potwierdzenia platnosci.");
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
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Podaj poprawny adres email.");
  }

  const user = await getUserByEmail(normalizedEmail);

  if (!user) {
    return {
      previewUrl: null,
      sent: false,
    };
  }

  await purgeTokensForUser("password_reset_tokens", user.id);

  const reset = await createStoredToken(
    "password_reset_tokens",
    user.id,
    PASSWORD_RESET_MAX_AGE_MS
  );

  const previewUrl = `${baseUrl}/reset-password?token=${reset.token}`;
  const emailResult = await sendPasswordResetEmail(user.email, previewUrl);

  return {
    previewUrl,
    sent: emailResult.sent,
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

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();

  await withTransaction(async (transaction) => {
    const tokenRows = await transaction.query<TokenRow>(
      `
        SELECT user_id, expires_at
        FROM password_reset_tokens
        WHERE token_hash = $1
        FOR UPDATE
      `,
      [hashToken(normalizedToken)]
    );
    const tokenRow = tokenRows[0];

    if (!tokenRow) {
      throw new Error("Link do resetu hasla jest niepoprawny albo juz wygasl.");
    }

    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      throw new Error("Link do resetu hasla wygasl. Popros o nowy.");
    }

    const userRows = await transaction.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 FOR UPDATE",
      [tokenRow.user_id]
    );

    if (!userRows[0]) {
      throw new Error("Nie znaleziono konta dla tego linku.");
    }

    await transaction.execute(
      "UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3",
      [passwordHash, now, tokenRow.user_id]
    );
    await transaction.execute("DELETE FROM password_reset_tokens WHERE user_id = $1", [
      tokenRow.user_id,
    ]);
    await transaction.execute("DELETE FROM sessions WHERE user_id = $1", [tokenRow.user_id]);
  });
};

export const changeCurrentUserPassword = async ({
  userId,
  currentPassword,
  newPassword,
}: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) => {
  const user = await getUserById(userId);

  if (!user) {
    throw new Error("Nie znaleziono konta.");
  }

  if (!user.password_hash) {
    throw new Error("To konto nie ma jeszcze hasla. Ustaw je przez link resetu hasla.");
  }

  if (newPassword.length < 8) {
    throw new Error("Nowe haslo musi miec co najmniej 8 znakow.");
  }

  const passwordMatches = await bcrypt.compare(currentPassword, user.password_hash);

  if (!passwordMatches) {
    throw new Error("Aktualne haslo jest niepoprawne.");
  }

  const passwordIsUnchanged = await bcrypt.compare(newPassword, user.password_hash);

  if (passwordIsUnchanged) {
    throw new Error("Nowe haslo musi roznic sie od aktualnego.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date().toISOString();

  await withTransaction(async (transaction) => {
    await transaction.execute(
      "UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3",
      [passwordHash, now, user.id]
    );
    await transaction.execute("DELETE FROM password_reset_tokens WHERE user_id = $1", [user.id]);
    await transaction.execute("DELETE FROM sessions WHERE user_id = $1", [user.id]);
  });
};

export const logoutCurrentSession = async () => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken) {
    await removeSessionByToken(sessionToken);
  }
};
