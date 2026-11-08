import { NextResponse } from "next/server";
import {
  changeCurrentUserPassword,
  getCurrentAccountData,
} from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const limited = await applyAuthRateLimit(request, "login", accountData.user.id);
  if (limited) return limited;

  try {
    const payload = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };

    await changeCurrentUserPassword({
      userId: accountData.user.id,
      currentPassword: payload.currentPassword ?? "",
      newPassword: payload.newPassword ?? "",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zmienic hasla.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
