const PRODUCTION_ORIGIN = "https://mexo.com.pl";

/**
 * Origin used to build links that are sent by e-mail (verification, password
 * reset).
 *
 * The `Origin` request header must never be used for this: an anonymous caller
 * controls it, so a forged header would make a genuine Mexo e-mail carry a link
 * to a foreign domain and hand the reset token to the attacker.
 *
 * Order: explicit `MEXO_PUBLIC_ORIGIN` (the same variable that the account
 * deletion origin check reads), then the production domain, and only outside
 * production the origin of the request itself, so local development on any port
 * keeps producing working preview links.
 */
export const getPublicOrigin = (request: Request): string => {
  const configured = process.env.MEXO_PUBLIC_ORIGIN?.trim();

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // An unusable value must not silently re-enable request-derived links.
    }
  }

  if (process.env.NODE_ENV === "production") return PRODUCTION_ORIGIN;

  return new URL(request.url).origin;
};
