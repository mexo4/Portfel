import { NextResponse } from "next/server";
import {
  getCurrentAuthenticatedUser,
  updateCurrentUserSubscription,
} from "@/lib/server/auth";
import type { SubscriptionPlan } from "@/types/portfolio";
import { isSubscriptionPlan } from "@/lib/entitlements";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json({
    plan: user.subscriptionPlan,
    status: user.subscriptionStatus,
    activatedAt: user.subscriptionActivatedAt,
    expiresAt: user.subscriptionExpiresAt,
  });
}

export async function PUT(request: Request) {
  const currentUser = await getCurrentAuthenticatedUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { plan?: unknown };

    if (!isSubscriptionPlan(payload.plan)) {
      return NextResponse.json({ error: "Niepoprawny plan." }, { status: 400 });
    }

    if (payload.plan !== "free") {
      return NextResponse.json({ error: "Samodzielny zakup planów płatnych nie jest jeszcze dostępny." }, { status: 409 });
    }
    const user = await updateCurrentUserSubscription(currentUser.id, payload.plan as SubscriptionPlan);

    return NextResponse.json({
      user,
      plan: user.subscriptionPlan,
      status: user.subscriptionStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie zapisac planu.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
