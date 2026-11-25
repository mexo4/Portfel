import { NextResponse } from "next/server";
import {
  changeCurrentUserPassword,
  getCurrentAuthenticatedUser,
} from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const limited = await applyAuthRateLimit(request, "login", user.id);
  if (limited) return limited;

  try {
    const payload = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };

    await changeCurrentUserPassword({
      userId: user.id,
      currentPassword: payload.currentPassword ?? "",
      newPassword: payload.newPassword ?? "",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się zmienić hasła.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
