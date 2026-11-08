import { NextResponse } from "next/server";
import { deleteUserByAdmin, getCurrentAccountData, updateUserAccessByAdmin } from "@/lib/server/auth";
import { isSubscriptionPlan } from "@/lib/entitlements";

export const runtime = "nodejs";

type AdminUserRouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function DELETE(_request: Request, context: AdminUserRouteContext) {
  const accountData = await getCurrentAccountData();

  if (!accountData || accountData.user.role !== "admin") {
    return NextResponse.json({ error: "Brak uprawnien admina." }, { status: 403 });
  }

  try {
    const params = await context.params;
    await deleteUserByAdmin(accountData.user.id, params.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie usunac uzytkownika.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: AdminUserRouteContext) {
  const accountData = await getCurrentAccountData();
  if (!accountData || accountData.user.role !== "admin") {
    return NextResponse.json({ error: "Brak uprawnien admina." }, { status: 403 });
  }

  try {
    const payload = await request.json() as Record<string, unknown>;
    const update: {
      role?: "user" | "admin";
      testerAccess?: boolean;
      espiAccess?: boolean;
      subscriptionPlan?: import("@/types/portfolio").SubscriptionPlan;
    } = {};
    if ("role" in payload) {
      if (payload.role !== "user" && payload.role !== "admin") throw new Error("Niepoprawna rola.");
      update.role = payload.role;
    }
    if ("testerAccess" in payload) {
      if (typeof payload.testerAccess !== "boolean") throw new Error("Niepoprawny dostęp Tester.");
      update.testerAccess = payload.testerAccess;
    }
    if ("espiAccess" in payload) {
      if (typeof payload.espiAccess !== "boolean") throw new Error("Niepoprawny dostęp ESPI.");
      update.espiAccess = payload.espiAccess;
    }
    if ("subscriptionPlan" in payload) {
      if (!isSubscriptionPlan(payload.subscriptionPlan)) throw new Error("Niepoprawny plan.");
      update.subscriptionPlan = payload.subscriptionPlan;
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: "Brak zmian." }, { status: 400 });
    const { userId } = await context.params;
    const user = await updateUserAccessByAdmin(accountData.user.id, userId, update);
    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zmienić uprawnień.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
