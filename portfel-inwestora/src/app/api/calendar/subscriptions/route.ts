import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  createCalendarSubscription,
  listCalendarSubscriptions,
} from "@/lib/server/calendar-subscriptions";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  try {
    return NextResponse.json(await listCalendarSubscriptions(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("GET /api/calendar/subscriptions failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Nie udało się pobrać subskrypcji." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  try {
    const subscription = await createCalendarSubscription(user.id, await request.json());
    return NextResponse.json({ subscription }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("INVALID") || message.includes("FORBIDDEN") ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? "Sprawdź nazwę, zakres i kategorie." : "Nie udało się zapisać subskrypcji." }, { status });
  }
}
