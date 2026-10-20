import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  revokeCalendarSubscription,
  updateCalendarSubscription,
} from "@/lib/server/calendar-subscriptions";

export const runtime = "nodejs";
type Context = { params: Promise<{ subscriptionId: string }> };

export async function PUT(request: Request, context: Context) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  const { subscriptionId } = await context.params;
  try {
    const subscription = await updateCalendarSubscription(user.id, subscriptionId, await request.json());
    return NextResponse.json({ subscription }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("NOT_FOUND") ? 404 : message.includes("INVALID") || message.includes("FORBIDDEN") ? 400 : 500;
    return NextResponse.json({ error: status === 404 ? "Nie znaleziono subskrypcji." : status === 400 ? "Sprawdź ustawienia subskrypcji." : "Nie udało się zapisać zmian." }, { status });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  const { subscriptionId } = await context.params;
  const revoked = await revokeCalendarSubscription(user.id, subscriptionId);
  return revoked
    ? NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Nie znaleziono subskrypcji." }, { status: 404 });
}
