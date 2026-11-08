import { NextResponse } from "next/server";
import { ACCOUNT_DELETION_CHALLENGE_COOKIE, getExpiredAccountDeletionCookieOptions, isSameOriginMutation } from "@/lib/server/account-deletion-http";
import { execute } from "@/lib/server/db";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Nieprawidłowe żądanie." }, { status: 403 });
  await execute("DELETE FROM account_deletion_challenges WHERE user_id = $1", [user.id]);
  const response = NextResponse.json({ success: true });
  response.cookies.set(ACCOUNT_DELETION_CHALLENGE_COOKIE, "", getExpiredAccountDeletionCookieOptions());
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
