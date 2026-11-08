import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { query } from "@/lib/server/db";

export type AuthRateLimitPolicy = {
  limit: number;
  identityLimit?: number;
  windowMs: number;
};

export const AUTH_RATE_LIMIT_POLICIES = {
  login: { limit: 10, identityLimit: 30, windowMs: 15 * 60_000 },
  register: { limit: 5, identityLimit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 4, identityLimit: 8, windowMs: 60 * 60_000 },
  verification: { limit: 4, identityLimit: 6, windowMs: 60 * 60_000 },
  resetToken: { limit: 8, identityLimit: 12, windowMs: 15 * 60_000 },
  espiSync: { limit: 3, windowMs: 15 * 60_000 },
  accountExport: { limit: 4, identityLimit: 2, windowMs: 60 * 60_000 },
  accountDeletion: { limit: 8, identityLimit: 8, windowMs: 60 * 60_000 },
} satisfies Record<string, AuthRateLimitPolicy>;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };
type RateLimitBucketRow = { bucket_hash: string; hit_count: number; reset_at: string };

export const resolveTrustedClientAddress = (headers: Headers, isProduction: boolean) => {
  const configuredHeader = process.env.MEXO_TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  const trustedHeader = configuredHeader ?? (isProduction ? "" : "x-real-ip");
  if (configuredHeader && trustedHeader !== "x-real-ip" && trustedHeader !== "cf-connecting-ip") {
    return null;
  }
  if (isProduction && !configuredHeader) return null;
  const candidate = trustedHeader === "cf-connecting-ip"
    ? headers.get("cf-connecting-ip")?.trim()
    : trustedHeader === "x-real-ip"
      ? headers.get("x-real-ip")?.trim()
      : null;
  if (candidate && candidate.length <= 64 && isIP(candidate) !== 0) return candidate;
  return isProduction ? null : "127.0.0.1";
};

export const createRateLimitBucketHash = (secret: string, scope: string, clientKey: string) =>
  createHmac("sha256", secret).update(`${scope}\0${clientKey}`).digest("hex");

/**
 * Fixed-window counter stored in PostgreSQL, so limits are shared across
 * serverless instances. No raw IP, email, token, or password is persisted.
 * If proxy identity or the HMAC secret is not configured, production auth
 * endpoints fail closed rather than silently becoming unprotected.
 */
export const enforceDistributedRateLimit = async (
  headers: Headers,
  scope: keyof typeof AUTH_RATE_LIMIT_POLICIES,
  identity: unknown = "",
  options: { now?: number; secret?: string; isProduction?: boolean } = {}
): Promise<RateLimitResult> => {
  const policy: AuthRateLimitPolicy = AUTH_RATE_LIMIT_POLICIES[scope];
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const configuredSecret = options.secret ?? process.env.MEXO_RATE_LIMIT_HMAC_KEY?.trim();
  const secret = configuredSecret || (!isProduction ? "mexo-development-only-rate-limit-key" : undefined);
  const address = resolveTrustedClientAddress(headers, isProduction);
  if (!secret || (isProduction && Buffer.byteLength(secret, "utf8") < 32) || !address) {
    throw new Error("Rate limit identity is not configured.");
  }

  const identityPart = typeof identity === "string" ? identity.trim().toLowerCase().slice(0, 320) : "";
  const buckets = [
    { hash: createRateLimitBucketHash(secret, `${scope}:ip`, address), limit: policy.limit },
    ...(identityPart && policy.identityLimit
      ? [{ hash: createRateLimitBucketHash(secret, `${scope}:identity`, identityPart), limit: policy.identityLimit }]
      : []),
  ];
  const now = options.now ?? Date.now();
  const windowStartMs = Math.floor(now / policy.windowMs) * policy.windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const rows = await query<RateLimitBucketRow>(
    `
      WITH cleanup_claim AS (
        UPDATE auth_rate_limit_maintenance
        SET last_cleaned_at = now()
        WHERE maintenance_key = 'auth-rate-limit'
          AND last_cleaned_at < now() - interval '12 hours'
        RETURNING maintenance_key
      ), cleanup AS (
        DELETE FROM auth_rate_limit_buckets
        WHERE window_started_at < now() - interval '48 hours'
          AND EXISTS (SELECT 1 FROM cleanup_claim)
        RETURNING bucket_hash
      ), updated_buckets AS (
        INSERT INTO auth_rate_limit_buckets (bucket_hash, window_started_at, hit_count)
        SELECT bucket_hash, $2::timestamptz, 1 FROM unnest($1::text[]) AS keys(bucket_hash)
        ON CONFLICT (bucket_hash, window_started_at) DO UPDATE
          SET hit_count = auth_rate_limit_buckets.hit_count + 1
        RETURNING bucket_hash, hit_count, window_started_at
      )
      SELECT bucket_hash, hit_count,
        (window_started_at + ($3::text || ' milliseconds')::interval)::text AS reset_at
      FROM updated_buckets
    `,
    [buckets.map((bucket) => bucket.hash), windowStart, policy.windowMs]
  );

  if (!rows.length) throw new Error("Rate limit counter did not return a result.");
  const limitByHash = new Map(buckets.map((bucket) => [bucket.hash, bucket.limit]));
  const blocked = rows.filter((bucket) => Number(bucket.hit_count) > (limitByHash.get(bucket.bucket_hash) ?? policy.limit));
  if (blocked.length === 0) return { allowed: true };
  const retryAfterSeconds = Math.max(1, ...blocked.map((bucket) => Math.ceil((Date.parse(bucket.reset_at) - now) / 1000)));
  return { allowed: false, retryAfterSeconds };
};
