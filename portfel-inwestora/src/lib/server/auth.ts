import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSubscriptionPlan } from "@/lib/entitlements";
import { findPortfolioPlanLimitViolation } from "@/lib/portfolio-plan-limits";
import { assertUniquePortfolioNames, normalizePortfolioBook, normalizePortfolioState } from "@/lib/portfolio-state";
import { getPortfolioInstrumentId, repairMisclassifiedXtbListingCurrencies } from "@/lib/operation-engine";
import type { NextResponse } from "next/server";
import { createFreshUserProfile, normalizeUserProfile } from "@/lib/profile";
import { execute, queryOne, withTransaction } from "@/lib/server/db";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/server/email";
import { syncPortfolioCoreTablesInTransaction } from "@/lib/server/portfolio-core-sync";
import { enrichPortfolioBookIssuerCountries } from "@/lib/issuer-country";
import {
  invalidateIssuerCountryCacheForIsin,
  resolveIssuerCountryByInstrument,
  resolveIssuerCountryByIsin,
} from "@/lib/server/issuer-country";
import { normalizeIssuerIsin } from "@/lib/issuer-country";
import {
  getPortfolioQuoteSnapshots,
  mergePortfolioBookQuoteSnapshots,
} from "@/lib/server/portfolio-quote-snapshots";
import type {
  AuthenticatedUser,
  InvestmentPortfolio,
  PortfolioBook,
  PortfolioState,
  IssuerCountrySource,
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
  subscription_activated_at: string | null;
  subscription_expires_at: string | null;
  subscription_grant_source: string | null;
  user_role: string;
  tester_access: boolean;
  espi_access: boolean;
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

export class EmailVerificationRequiredError extends Error {
  userId: string;

  constructor(userId: string) {
    super("Potwierdź adres email przed logowaniem.");
    this.name = "EmailVerificationRequiredError";
    this.userId = userId;
  }
}

export class PortfolioRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("Dane portfela zostały zmienione w innej sesji. Odświeżono aktualny stan.");
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
  isSubscriptionPlan(plan) ? plan : "free";

const normalizeSubscriptionStatus = (
  status: string | null | undefined
): SubscriptionStatus => {
  if (
    status === "trialing" ||
    status === "past_due" ||
    status === "canceled" ||
    status === "expired"
  ) {
    return status;
  }

  return "active";
};

export const normalizeUserRole = (role: string | null | undefined): AuthenticatedUser["role"] =>
  role === "admin" ? "admin" : "user";

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
    | "subscription_activated_at"
    | "subscription_expires_at"
    | "subscription_grant_source"
    | "subscription_updated_at"
    | "user_role"
    | "tester_access"
    | "espi_access"
  >
): AuthenticatedUser => ({
  id: user.id,
  email: user.email,
  displayName: user.display_name,
  createdAt: user.created_at,
  emailVerifiedAt: user.email_verified_at,
  subscriptionPlan: normalizeSubscriptionPlan(user.subscription_plan),
  subscriptionStatus: normalizeSubscriptionStatus(user.subscription_status),
  subscriptionActivatedAt: user.subscription_activated_at,
  subscriptionExpiresAt: user.subscription_expires_at,
  subscriptionGrantSource: user.subscription_grant_source,
  subscriptionUpdatedAt: user.subscription_updated_at,
  role: normalizeUserRole(user.user_role),
  testerAccess: user.tester_access === true,
  espiAccess: user.espi_access === true,
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

const needsXtbListingCurrencyRepair = (value: unknown) => {
  if (!hasPortfolioV2Shape(value)) {
    return false;
  }

  return (value as { portfolios: InvestmentPortfolio[] }).portfolios.some(
    (portfolio) => repairMisclassifiedXtbListingCurrencies(portfolio) !== portfolio
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
      needsMigration:
        !hasPortfolioV2Shape(rawPortfolio) || needsXtbListingCurrencyRepair(rawPortfolio),
    };
  } catch {
    return {
      portfolioBook: normalizePortfolioBook([]),
      needsMigration: true,
    };
  }
};

const issuerMetadataSources = new Set<IssuerCountrySource>([
  "catalog",
  "issuer-profile",
  "broker-confirmed",
  "gleif-isin",
]);

const getConfirmedIssuerMetadataByIsin = (book: PortfolioBook) => {
  const metadata = new Map<string, string>();
  for (const portfolio of book.portfolios) {
    const instrumentsById = new Map((portfolio.instruments ?? []).map((instrument) => [instrument.id, instrument]));
    for (const asset of portfolio.assets) {
      const instrumentId = getPortfolioInstrumentId(portfolio.id, asset);
      const instrument = instrumentsById.get(instrumentId);
      const source = asset.issuerCountrySource ?? instrument?.metadata?.issuerCountrySource;
      const country = asset.issuerCountry ?? instrument?.metadata?.issuerCountry;
      const isin = normalizeIssuerIsin(asset.isin) ?? normalizeIssuerIsin(instrument?.isin);
      if (isin && typeof country === "string" && country.trim() &&
        typeof source === "string" && issuerMetadataSources.has(source as IssuerCountrySource)) {
        metadata.set(isin, `${source}:${country.trim().toUpperCase()}`);
      }
    }
    for (const instrument of portfolio.instruments ?? []) {
      const source = instrument.metadata?.issuerCountrySource;
      const country = instrument.metadata?.issuerCountry;
      const isin = normalizeIssuerIsin(instrument.isin);
      if (isin && typeof country === "string" && country.trim() &&
        typeof source === "string" && issuerMetadataSources.has(source as IssuerCountrySource)) {
        metadata.set(isin, `${source}:${country.trim().toUpperCase()}`);
      }
    }
  }
  return metadata;
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
  subscription_activated_at,
  subscription_expires_at,
  subscription_grant_source,
  user_role,
  tester_access,
  espi_access,
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

const getSessionUser = (token: string, includePortfolio = false) =>
  queryOne<SessionUserRow>(
    `
      SELECT ${sessionUserColumnsWithoutPortfolio},
        ${includePortfolio ? "users.portfolio_json" : "'' AS portfolio_json"},
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

const getCurrentSessionUser = async (includePortfolio = false) => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) return null;

  const sessionUser = await getSessionUser(sessionToken, includePortfolio);

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
  return sessionUser ? toAuthenticatedUser(sessionUser) : null;
};

/**
 * The signed-in user together with their profile, for endpoints that never
 * look at the portfolio.  Same shape as the `user` and `profile` of
 * getCurrentAccountData, without parsing the portfolio, merging quote snapshots
 * or enriching issuer countries on every call.
 */
export const getCurrentAccountIdentity = async () => {
  const sessionUser = await getCurrentSessionUser();
  if (!sessionUser) return null;

  return {
    user: toAuthenticatedUser(sessionUser),
    profile: parseUserProfile(sessionUser),
  };
};

export const isGoogleAccountLinkedToUser = async (userId: string, providerAccountId: string) => {
  const linked = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM auth_accounts
     WHERE user_id = $1 AND provider = 'google' AND provider_account_id = $2`,
    [userId, providerAccountId]
  );
  return Boolean(linked);
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
      throw new Error("Konto z tym adresem email już istnieje.");
    }

    return toAuthenticatedUser(existingUser);
  }

  if (!normalizedName || normalizedName.length < 2) {
    throw new Error("Podaj nazwę użytkownika złożoną z co najmniej 2 znaków.");
  }

  if (password.length < 8) {
    throw new Error("Hasło musi mieć co najmniej 8 znaków.");
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

  const initialSubscriptionPlan = "free" satisfies SubscriptionPlan;
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
    subscriptionActivatedAt: null,
    subscriptionExpiresAt: null,
    subscriptionGrantSource: null,
    subscriptionUpdatedAt: now,
    role: "user",
    testerAccess: false,
    espiAccess: false,
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
  const normalizedName = displayName?.trim() || normalizedEmail.split("@")[0] || "Użytkownik";

  if (!providerAccountId || !normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Dostawca logowania nie zwrócił poprawnej tożsamości.");
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
    const initialSubscriptionPlan = "free" satisfies SubscriptionPlan;
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
    throw new Error("Nie udało się połączyć konta Google z kontem Mexo.");
  }

  return toAuthenticatedUser(user);
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
      "To konto nie ma ustawionego hasła. Kontynuuj z Google albo ustaw hasło przez reset."
    );
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    throw new Error("Niepoprawny email lub hasło.");
  }

  if (!user.email_verified_at) {
    throw new EmailVerificationRequiredError(user.id);
  }

  return toAuthenticatedUser(user);
};

export type CurrentAccountDataOptions = {
  /** Issuer enrichment is needed by portfolio structure, not chart history. */
  enrichIssuerCountries?: boolean;
};

export const getCurrentAccountData = async ({
  enrichIssuerCountries = true,
}: CurrentAccountDataOptions = {}) => {
  // Load the portfolio read model in the indexed session lookup instead of
  // paying for a second users query on every workspace page and API call.
  const sessionUser = await getCurrentSessionUser(true);

  if (!sessionUser) return null;

  const user = sessionUser;
  const storedPortfolio = parsePortfolioBook(user.portfolio_json);
  let portfolioBook = storedPortfolio.portfolioBook;
  let portfolioRevision = user.portfolio_revision;

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

  // Quote snapshots carry verified listing metadata (including quote
  // currency/provider), which is also required by historical price lookup.
  portfolioBook = mergePortfolioBookQuoteSnapshots(
    portfolioBook,
    await getPortfolioQuoteSnapshots(portfolioBook.portfolios.map((portfolio) => portfolio.id))
  );
  if (enrichIssuerCountries) {
    portfolioBook = await enrichPortfolioBookIssuerCountries(
      portfolioBook,
      resolveIssuerCountryByIsin,
      resolveIssuerCountryByInstrument
    );
  }

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
    throw new Error("Nie znaleziono użytkownika.");
  }

  const normalizedProfile = normalizeUserProfile(nextProfile, {
    displayName: existingUser.display_name,
    email: existingUser.email,
    createdAt: existingUser.created_at,
    updatedAt: new Date().toISOString(),
  });

  if (!normalizedProfile.displayName || normalizedProfile.displayName.length < 2) {
    throw new Error("Nazwa użytkownika musi mieć co najmniej 2 znaki.");
  }

  const normalizedEmail = normalizeEmail(normalizedProfile.email);

  if (!normalizedEmail || !isEmailValid(normalizedEmail)) {
    throw new Error("Podaj poprawny adres email.");
  }

  const sameEmailUser = await getUserByEmail(normalizedEmail);
  if (sameEmailUser && sameEmailUser.id !== userId) {
    throw new Error("Ten adres email jest już zajęty.");
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
    throw new Error("Nie udało się zapisać profilu.");
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
    throw new Error("Nie znaleziono użytkownika.");
  }

  const account = toAuthenticatedUser(existingUser);
  const normalizedPortfolio = normalizePortfolioBook(portfolio);
  // Client-side feedback is helpful, but this is the authoritative guard for
  // every portfolio-book write, including concurrent tabs and API callers.
  assertUniquePortfolioNames(normalizedPortfolio.portfolios);

  const updatedAt = new Date().toISOString();
  const requestedRevision = Number.isInteger(expectedPortfolioRevision)
    ? expectedPortfolioRevision
    : existingUser.portfolio_revision;
  const nextIssuerMetadata = getConfirmedIssuerMetadataByIsin(normalizedPortfolio);

  const result = await withTransaction(async (transaction) => {
    const currentRows = await transaction.query<{
      portfolio_revision: number;
      portfolio_core_revision: number;
      subscription_plan: string;
      subscription_status: string;
      subscription_expires_at: string | null;
      user_role: string;
      tester_access: boolean;
      espi_access: boolean;
      portfolio_json: string;
    }>(
      // getUserById leaves portfolio_json out (light account reads), so the stored book is read
      // here, on the locked row: the plan limits and the issuer cache compare against it.
      `SELECT portfolio_revision, portfolio_core_revision, subscription_plan, subscription_status,
        subscription_expires_at, user_role, tester_access, espi_access, portfolio_json
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const currentUser = currentRows[0];

    if (!currentUser) {
      throw new Error("Nie znaleziono użytkownika.");
    }

    if (currentUser.portfolio_revision !== requestedRevision) {
      throw new PortfolioRevisionConflictError(currentUser.portfolio_revision);
    }

    const previousPortfolioBook = parsePortfolioBook(currentUser.portfolio_json ?? "").portfolioBook;

    if (options.enforcePlanLimit !== false) {
      const lockedAccount = {
        ...account,
        subscriptionPlan: normalizeSubscriptionPlan(currentUser.subscription_plan),
        subscriptionStatus: normalizeSubscriptionStatus(currentUser.subscription_status),
        subscriptionExpiresAt: currentUser.subscription_expires_at,
        role: normalizeUserRole(currentUser.user_role),
        testerAccess: currentUser.tester_access === true,
        espiAccess: currentUser.espi_access === true,
      };
      const violation = findPortfolioPlanLimitViolation(lockedAccount, previousPortfolioBook, normalizedPortfolio);
      if (violation) {
        throw new Error(violation);
      }
    }

    const previousIssuerMetadata = getConfirmedIssuerMetadataByIsin(previousPortfolioBook);
    const issuerIsinsToInvalidate = Array.from(
      new Set([...previousIssuerMetadata.keys(), ...nextIssuerMetadata.keys()])
    ).filter((isin) => previousIssuerMetadata.get(isin) !== nextIssuerMetadata.get(isin));

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
      throw new Error("Nie udało się zapisać portfela.");
    }

    await syncPortfolioCoreTablesInTransaction(transaction, userId, normalizedPortfolio);
    await transaction.execute(
      "UPDATE users SET portfolio_core_revision = $1 WHERE id = $2",
      [updatedUser.portfolio_revision, userId]
    );

    return {
      portfolioBook: normalizedPortfolio,
      portfolioRevision: updatedUser.portfolio_revision,
      issuerIsinsToInvalidate,
    };
  });

  await Promise.all(result.issuerIsinsToInvalidate.map(async (isin) => {
    try {
      await invalidateIssuerCountryCacheForIsin(isin);
    } catch {
      // Issuer metadata cache invalidation is best-effort and cannot undo a saved portfolio.
    }
  }));

  return { portfolioBook: result.portfolioBook, portfolioRevision: result.portfolioRevision };
};

export const updateCurrentUserSubscription = async (
  userId: string,
  plan: SubscriptionPlan
) => {
  if (plan !== "free") throw new Error("Płatne plany wymagają zaufanego potwierdzenia nadania.");

  const now = new Date().toISOString();

  await execute(
    `
      UPDATE users
      SET subscription_plan = $1,
        subscription_status = $2,
        subscription_updated_at = $3,
        subscription_activated_at = NULL,
        subscription_expires_at = NULL,
        subscription_grant_source = NULL,
        updated_at = $4
      WHERE id = $5
    `,
    [plan, "active", now, now, userId]
  );

  const updatedUser = await getUserById(userId);

  if (!updatedUser) {
    throw new Error("Nie udało się zapisać planu.");
  }

  return toAuthenticatedUser(updatedUser);
};

export type AdminUserAccessUpdate = {
  role?: "user" | "admin";
  testerAccess?: boolean;
  espiAccess?: boolean;
  subscriptionPlan?: SubscriptionPlan;
};

export const updateUserAccessByAdmin = async (
  adminUserId: string,
  targetUserId: string,
  update: AdminUserAccessUpdate
) => {
  if (adminUserId === targetUserId) throw new Error("Nie możesz zmienić własnych uprawnień.");
  if (update.subscriptionPlan && !isSubscriptionPlan(update.subscriptionPlan)) {
    throw new Error("Niepoprawny plan abonamentowy.");
  }
  if (update.role !== undefined && update.role !== "user" && update.role !== "admin") {
    throw new Error("Niepoprawna rola użytkownika.");
  }

  await withTransaction(async (transaction) => {
    // Serialize admin role changes with account deletion to preserve at least
    // one administrator under concurrent requests.
    await transaction.query("SELECT pg_advisory_xact_lock($1::bigint)", ["734219806541"]);
    const adminRows = await transaction.query<{ user_role: string }>(
      "SELECT user_role FROM users WHERE id = $1 FOR UPDATE",
      [adminUserId]
    );
    if (adminRows[0]?.user_role !== "admin") throw new Error("Brak roli administratora.");
    const targetRows = await transaction.query<Pick<UserRow,
      "id" | "user_role" | "tester_access" | "espi_access" | "subscription_plan" |
      "subscription_status" | "subscription_activated_at" | "subscription_expires_at" | "subscription_grant_source"
    >>(
      `SELECT id, user_role, tester_access, espi_access, subscription_plan,
        subscription_status, subscription_activated_at, subscription_expires_at, subscription_grant_source
       FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId]
    );
    const targetUser = targetRows[0];
    if (!targetUser) throw new Error("Nie znaleziono użytkownika.");

    const now = new Date();
    const updatedAt = now.toISOString();
    const planWasExplicitlyUpdated = update.subscriptionPlan !== undefined;
    const plan = update.subscriptionPlan ?? normalizeSubscriptionPlan(targetUser.subscription_plan);
    const isPaidPlan = plan !== "free";
    const expiresAt = !planWasExplicitlyUpdated
      ? targetUser.subscription_expires_at
      : isPaidPlan ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
    const activatedAt = !planWasExplicitlyUpdated
      ? targetUser.subscription_activated_at
      : isPaidPlan ? updatedAt : null;
    const source = !planWasExplicitlyUpdated
      ? targetUser.subscription_grant_source
      : isPaidPlan ? `admin:${adminUserId}` : null;
    const subscriptionStatus = !planWasExplicitlyUpdated
      ? normalizeSubscriptionStatus(targetUser.subscription_status)
      : "active";

    const nextRole = update.role ?? normalizeUserRole(targetUser.user_role);
    if (targetUser.user_role === "admin" && nextRole !== "admin") {
      const adminCount = await transaction.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM users WHERE user_role = 'admin'"
      );
      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throw new Error("Najpierw nadaj rolę administratora innemu kontu.");
      }
    }

    await transaction.execute(
      `UPDATE users SET user_role = $1, tester_access = $2, espi_access = $3,
        subscription_plan = $4, subscription_status = $5,
        subscription_activated_at = $6, subscription_expires_at = $7,
        subscription_grant_source = $8, subscription_updated_at = $9, updated_at = $9
       WHERE id = $10`,
      [
        nextRole,
        update.testerAccess ?? targetUser.tester_access,
        update.espiAccess ?? targetUser.espi_access,
        plan,
        subscriptionStatus,
        activatedAt,
        expiresAt,
        source,
        updatedAt,
        targetUserId,
      ]
    );
  });

  const updatedUser = await getUserById(targetUserId);
  if (!updatedUser) throw new Error("Nie udało się odczytać zmienionych uprawnień.");
  return toAuthenticatedUser(updatedUser);
};

export const deleteUserByAdmin = async (adminUserId: string, targetUserId: string) => {
  if (adminUserId === targetUserId) throw new Error("Nie możesz usunąć własnego konta admina.");
  await withTransaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock($1::bigint)", ["734219806541"]);
    const adminRows = await transaction.query<{ user_role: string }>(
      "SELECT user_role FROM users WHERE id = $1 FOR UPDATE",
      [adminUserId]
    );
    if (adminRows[0]?.user_role !== "admin") throw new Error("Brak roli administratora.");
    const targetRows = await transaction.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 FOR UPDATE",
      [targetUserId]
    );
    if (!targetRows[0]) throw new Error("Nie znaleziono użytkownika.");
    await transaction.execute(
      `DELETE FROM portfolio_engine_cache WHERE portfolio_id IN
       (SELECT id FROM core_portfolios WHERE user_id = $1)`, [targetUserId]
    );
    await transaction.execute("DELETE FROM users WHERE id = $1", [targetUserId]);
  });
};

export const requestEmailVerificationForUser = async (userId: string, baseUrl: string) => {
  const user = await getUserById(userId);

  if (!user) {
    throw new Error("Nie znaleziono użytkownika.");
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
    throw new Error("Link weryfikacyjny jest niepoprawny albo już wygasł.");
  }

  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    await purgeTokensForUser("email_verification_tokens", tokenRow.user_id);
    throw new Error("Link weryfikacyjny wygasł. Wyślij nowy z panelu konta.");
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
    throw new Error("Nie udało się potwierdzić adresu email.");
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
    throw new Error("Brakuje tokenu resetu hasła.");
  }

  if (password.length < 8) {
    throw new Error("Nowe hasło musi mieć co najmniej 8 znaków.");
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
      throw new Error("Link do resetu hasła jest niepoprawny albo już wygasł.");
    }

    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      throw new Error("Link do resetu hasła wygasł. Poproś o nowy.");
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
    throw new Error("To konto nie ma jeszcze hasła. Ustaw je przez link resetu hasła.");
  }

  if (newPassword.length < 8) {
    throw new Error("Nowe hasło musi mieć co najmniej 8 znaków.");
  }

  const passwordMatches = await bcrypt.compare(currentPassword, user.password_hash);

  if (!passwordMatches) {
    throw new Error("Aktualne hasło jest niepoprawne.");
  }

  const passwordIsUnchanged = await bcrypt.compare(newPassword, user.password_hash);

  if (passwordIsUnchanged) {
    throw new Error("Nowe hasło musi różnić się od aktualnego.");
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
