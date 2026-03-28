import { NextResponse } from "next/server";
import {
  appendSessionCookie,
  createSessionForUser,
  loginAccount,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const user = await loginAccount({
      email: payload.email ?? "",
      password: payload.password ?? "",
    });

    const session = createSessionForUser(user.id);
    const response = NextResponse.json({ user });
    appendSessionCookie(response, session.token, session.expiresAt);

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zalogowac.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
