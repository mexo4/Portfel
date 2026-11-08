import { enforceDistributedRateLimit } from "@/lib/server/auth-rate-limit";

export const applyAuthRateLimit = async (
  request: Request,
  scope: "login" | "register" | "passwordReset" | "verification" | "resetToken" | "espiSync",
  identity = ""
) => {
  try {
    const result = await enforceDistributedRateLimit(request.headers, scope, identity);
    if (result.allowed) return null;
    return new Response(JSON.stringify({ error: "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(result.retryAfterSeconds),
      },
    });
  } catch {
    // Failing open would disable the abuse controls across instances.
    return new Response(JSON.stringify({ error: "Logowanie jest chwilowo niedostępne. Spróbuj ponownie za chwilę." }), {
      status: 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": "30",
      },
    });
  }
};
