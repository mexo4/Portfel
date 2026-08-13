import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  getUserDashboardLayout,
  saveUserDashboardLayout,
} from "@/lib/server/dashboard-layout";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json(await getUserDashboardLayout(user.id));
}

export async function PUT(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { layout?: unknown };
    if (!("layout" in payload)) {
      return NextResponse.json({ error: "Brakuje konfiguracji pulpitu." }, { status: 400 });
    }

    return NextResponse.json(await saveUserDashboardLayout(user.id, payload.layout));
  } catch {
    return NextResponse.json({ error: "Nie udało się zapisać układu pulpitu." }, { status: 400 });
  }
}
