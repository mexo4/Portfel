import { NextResponse } from "next/server";
import { requestPasswordResetForEmail } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
    };

    const baseUrl = request.headers.get("origin") ?? new URL(request.url).origin;
    const result = await requestPasswordResetForEmail(payload.email ?? "", baseUrl);

    return NextResponse.json({
      success: true,
      previewUrl: process.env.NODE_ENV === "production" ? null : result.previewUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie przygotowac resetu hasla.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
