import { enforceDistributedRateLimit } from "../../src/lib/server/auth-rate-limit.ts";

const requestCount = Number(process.argv[2] ?? 0);
const now = Number(process.argv[3] ?? Date.now());
const outcomes = await Promise.all(Array.from({ length: requestCount }, () =>
  enforceDistributedRateLimit(
    new Headers({ "x-real-ip": "203.0.113.240" }),
    "login",
    "",
    { isProduction: true, now, secret: process.env.MEXO_RATE_LIMIT_HMAC_KEY }
  )
));

console.log(JSON.stringify({ allowed: outcomes.filter((outcome) => outcome.allowed).length, blocked: outcomes.filter((outcome) => !outcome.allowed).length }));
await globalThis.portfelPostgresPool?.end();
