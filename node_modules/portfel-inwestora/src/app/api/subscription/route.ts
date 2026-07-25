import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
  updateCurrentUserSubscription,
} from "@/lib/server/auth";
import type { SubscriptionPlan } from "@/types/portfolio";

export const runtime = "nodejs";

const isSubscriptionPlan = (value: unknown): value is SubscriptionPlan =>
  value === "free" || value === "pro";

export async function GET() {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json({
    plan: accountData.user.subscriptionPlan,
    status: accountData.user.subscriptionStatus,
  });
}

export async function PUT(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { plan?: unknown };

    if (!isSubscriptionPlan(payload.plan)) {
      return NextResponse.json({ error: "Niepoprawny plan." }, { status: 400 });
    }

    const user = await updateCurrentUserSubscription(accountData.user.id, payload.plan);

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
