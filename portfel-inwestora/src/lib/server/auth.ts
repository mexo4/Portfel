import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { normalizePortfolioState } from "@/lib/portfolio-state";
import type { NextResponse } from "next/server";
import { createFreshUserProfile, normalizeUserProfile } from "@/lib/profile";
import db from "@/lib/server/db";
import type {
  AuthenticatedUser,
  PortfolioState,
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

const getSessionExpiry = () => new Date(Date.now() + SESSION_MAX_AGE_MS);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createRawToken = () => randomBytes(32).toString("hex");

const isEmailValid = (email: string) => /^\S+@\S+\.\S+$/.test(email);

const toAuthenticatedUser = (
  user: Pick<UserRow, "id" | "email" | "display_name" | "created_at" | "email_verified_at">
): AuthenticatedUser => ({
  id: user.id,
  email: user.email,
  displayName: user.display_name,
  createdAt: user.created_at,
  emailVerifiedAt: user.email_verified_at,
});

const parsePortfolio = (portfolioJson: string): PortfolioState => {
  try {
    return normalizePortfolioState(JSON.parse(portfolioJson));
  } catch {
    return normalizePortfolioState([]);
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
  db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;

const getUserById = (id: string) =>
  db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;

const getSessionUser = (token: string) =>
  db
    .prepare(
      `
        SELECT users.*, sessions.expires_at
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
      `
    )
    .get(hashToken(token)) as SessionUserRow | undefined;

const getTokenRow = (tableName: "email_verification_tokens" | "password_reset_tokens", token: string) =>
  db
    .prepare(`SELECT user_id, expires_at FROM ${tableName} WHERE token_hash = ?`)
    .get(hashToken(token)) as TokenRow | undefined;

const removeSessionByToken = (token: string) => {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
};

const removeSessionsByUserId = (userId: string) => {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
};

const purgeTokensForUser = (
  tableName: "email_verification_tokens" | "password_reset_tokens",
  userId: string
) => {
  db.prepare(`DELETE FROM ${tableName} WHERE user_id = ?`).run(userId);
};

const createStoredToken = (
  tableName: "email_verification_tokens" | "password_reset_tokens",
  userId: string,
  maxAgeMs: number
) => {
  const token = createRawToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + maxAgeMs).toISOString();

  db.prepare(
    `
      INSERT INTO ${tableName} (id, user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(randomUUID(), userId, hashToken(token), now, expiresAt);

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

export const createSessionForUser = (userId: string) => {
  const rawToken = createRawToken();
  const now = new Date().toISOString();
  const expiresAt = getSessionExpiry();

  db.prepare(
    `
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(randomUUID(), userId, hashToken(rawToken), now, expiresAt.toISOString());

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

  if (getUserByEmail(normalizedEmail)) {
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

  db.prepare(
    `
      INSERT INTO users (
        id,
        email,
        password_hash,
        display_name,
        email_verified_at,
        profile_json,
        portfolio_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    userId,
    normalizedEmail,
    passwordHash,
    normalizedName,
    null,
    JSON.stringify(profile),
    JSON.stringify([]),
    now,
    now
  );

  return {
    id: userId,
    email: normalizedEmail,
    displayName: normalizedName,
    createdAt: now,
    emailVerifiedAt: null,
  } satisfies AuthenticatedUser;
};

export const loginAccount = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = getUserByEmail(normalizedEmail);

  if (!user) {
    throw new Error("Nie znaleziono konta z tym adresem email.");
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    throw new Error("Niepoprawny email lub haslo.");
  }

  return toAuthenticatedUser(user);
};

export const getCurrentAccountData = async () => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) return null;

  const sessionUser = getSessionUser(sessionToken);

  if (!sessionUser) return null;

  if (new Date(sessionUser.expires_at).getTime() <= Date.now()) {
    removeSessionByToken(sessionToken);
    return null;
  }

  return {
    user: toAuthenticatedUser(sessionUser),
    profile: parseUserProfile(sessionUser),
    ...parsePortfolio(sessionUser.portfolio_json),
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
  const existingUser = getUserById(userId);

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

  const sameEmailUser = getUserByEmail(normalizedProfile.email);
  if (sameEmailUser && sameEmailUser.id !== userId) {
    throw new Error("Ten adres email jest juz zajety.");
  }

  const now = new Date().toISOString();
  const emailChanged = normalizedProfile.email !== existingUser.email;
  const nextEmailVerifiedAt = emailChanged ? null : existingUser.email_verified_at;

  if (emailChanged) {
    purgeTokensForUser("email_verification_tokens", userId);
  }

  db.prepare(
    `
      UPDATE users
      SET email = ?, display_name = ?, email_verified_at = ?, profile_json = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(
    normalizedProfile.email,
    normalizedProfile.displayName,
    nextEmailVerifiedAt,
    JSON.stringify({
      ...normalizedProfile,
      updatedAt: now,
    }),
    now,
    userId
  );

  const updatedUser = getUserById(userId);

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
  portfolio: PortfolioState
) => {
  const existingUser = getUserById(userId);

  if (!existingUser) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  db.prepare(
    `
      UPDATE users
      SET portfolio_json = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(JSON.stringify(normalizePortfolioState(portfolio)), new Date().toISOString(), userId);

  return normalizePortfolioState(portfolio);
};

export const requestEmailVerificationForUser = async (userId: string, baseUrl: string) => {
  const user = getUserById(userId);

  if (!user) {
    throw new Error("Nie znaleziono uzytkownika.");
  }

  if (user.email_verified_at) {
    return {
      previewUrl: null,
      alreadyVerified: true,
    };
  }

  purgeTokensForUser("email_verification_tokens", userId);

  const verification = createStoredToken(
    "email_verification_tokens",
    userId,
    EMAIL_VERIFICATION_MAX_AGE_MS
  );

  return {
    previewUrl: `${baseUrl}/verify-email?token=${verification.token}`,
    alreadyVerified: false,
  };
};

export const verifyEmailToken = async (token: string) => {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new Error("Brakuje tokenu weryfikacyjnego.");
  }

  const tokenRow = getTokenRow("email_verification_tokens", normalizedToken);

  if (!tokenRow) {
    throw new Error("Link weryfikacyjny jest niepoprawny albo juz wygasl.");
  }

  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    purgeTokensForUser("email_verification_tokens", tokenRow.user_id);
    throw new Error("Link weryfikacyjny wygasl. Wyslij nowy z panelu konta.");
  }

  const user = getUserById(tokenRow.user_id);

  if (!user) {
    purgeTokensForUser("email_verification_tokens", tokenRow.user_id);
    throw new Error("Nie znaleziono konta dla tego linku.");
  }

  const verifiedAt = new Date().toISOString();

  db.prepare("UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?").run(
    verifiedAt,
    verifiedAt,
    user.id
  );

  purgeTokensForUser("email_verification_tokens", user.id);

  const updatedUser = getUserById(user.id);

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

  const user = getUserByEmail(normalizedEmail);

  if (!user) {
    return {
      previewUrl: null,
    };
  }

  purgeTokensForUser("password_reset_tokens", user.id);

  const reset = createStoredToken(
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

  const tokenRow = getTokenRow("password_reset_tokens", normalizedToken);

  if (!tokenRow) {
    throw new Error("Link do resetu hasla jest niepoprawny albo juz wygasl.");
  }

  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    purgeTokensForUser("password_reset_tokens", tokenRow.user_id);
    throw new Error("Link do resetu hasla wygasl. Popros o nowy.");
  }

  const user = getUserById(tokenRow.user_id);

  if (!user) {
    purgeTokensForUser("password_reset_tokens", tokenRow.user_id);
    throw new Error("Nie znaleziono konta dla tego linku.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();

  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    passwordHash,
    now,
    user.id
  );

  purgeTokensForUser("password_reset_tokens", user.id);
  removeSessionsByUserId(user.id);
};

export const logoutCurrentSession = async () => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken) {
    removeSessionByToken(sessionToken);
  }
};
