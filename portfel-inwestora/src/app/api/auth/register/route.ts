import { NextResponse } from "next/server";
import {
  appendSessionCookie,
  createSessionForUser,
  registerAccount,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      displayName?: string;
      email?: string;
      password?: string;
    };

    const user = await registerAccount({
      displayName: payload.displayName ?? "",
      email: payload.email ?? "",
      password: payload.password ?? "",
    });

    const session = createSessionForUser(user.id);
    const response = NextResponse.json({ user });
    appendSessionCookie(response, session.token, session.expiresAt);

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zalozyc konta.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
