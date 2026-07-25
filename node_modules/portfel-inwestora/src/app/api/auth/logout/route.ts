import { NextResponse } from "next/server";
import { clearSessionCookie, logoutCurrentSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST() {
  await logoutCurrentSession();
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
