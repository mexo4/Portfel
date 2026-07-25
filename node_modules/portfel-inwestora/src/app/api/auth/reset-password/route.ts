import { NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      token?: string;
      password?: string;
    };

    await resetPasswordWithToken(payload.token ?? "", payload.password ?? "");

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie zresetowac hasla.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
