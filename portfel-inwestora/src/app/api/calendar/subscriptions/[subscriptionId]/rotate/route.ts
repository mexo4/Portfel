import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { rotateCalendarSubscriptionToken } from "@/lib/server/calendar-subscriptions";

export const runtime = "nodejs";
type Context = { params: Promise<{ subscriptionId: string }> };

export async function POST(_request: Request, context: Context) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  const { subscriptionId } = await context.params;
  try {
    const subscription = await rotateCalendarSubscriptionToken(user.id, subscriptionId);
    return NextResponse.json({ subscription }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nie znaleziono subskrypcji." }, { status: 404 });
  }
}
