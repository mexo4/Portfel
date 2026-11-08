export const ACCOUNT_DELETION_CHALLENGE_COOKIE = "mexo_account_deletion_step_up";

export const getAccountDeletionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/account",
  maxAge: 10 * 60,
});

export const getExpiredAccountDeletionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/account",
  expires: new Date(0),
});

export const isSameOriginMutation = (request: Request) => {
  const receivedOrigin = request.headers.get("origin");
  if (!receivedOrigin || receivedOrigin === "null") return false;
  let origin: URL;
  try {
    origin = new URL(receivedOrigin);
  } catch {
    return false;
  }

  const configuredOrigin = process.env.MEXO_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      if (origin.origin !== new URL(configuredOrigin).origin) return false;
    } catch {
      return false;
    }
  } else if (process.env.NODE_ENV === "production") {
    if (origin.origin !== "https://mexo.com.pl") return false;
  } else {
    let requestOrigin: URL;
    try {
      requestOrigin = new URL(request.url);
    } catch {
      return false;
    }
    if (origin.origin !== requestOrigin.origin) return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
};
