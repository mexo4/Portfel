import { NextResponse } from "next/server";
import { enforceDistributedRateLimit } from "@/lib/server/auth-rate-limit";

export const applyAuthRateLimit = async (
  request: Request,
  scope: "login" | "register" | "passwordReset" | "verification" | "resetToken" | "espiSync",
  identity = ""
) => {
  try {
    const result = await enforceDistributedRateLimit(request.headers, scope, identity);
    if (result.allowed) return null;
    return NextResponse.json(
      { error: "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie." },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
    );
  } catch {
    // Failing open would disable the abuse controls across instances.
    return NextResponse.json(
      { error: "Logowanie jest chwilowo niedostępne. Spróbuj ponownie za chwilę." },
      { status: 503, headers: { "Retry-After": "30" } }
    );
  }
};
