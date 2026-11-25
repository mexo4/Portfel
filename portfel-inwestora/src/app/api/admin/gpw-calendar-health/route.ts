import { NextResponse } from "next/server";
import { getCurrentAccountData } from "@/lib/server/auth";
import { getGpwCalendarHealth } from "@/lib/server/gpw-calendar-health";
import { assessGpwCalendarHealth } from "@/lib/gpw-calendar-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only health of the GPW events calendar (admins only): projection backlog, review queue, row invariants. */
export async function GET() {
  const accountData = await getCurrentAccountData();
  if (!accountData || accountData.user.role !== "admin") {
    return NextResponse.json({ error: "Brak uprawnień admina." }, { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
  try {
    const health = await getGpwCalendarHealth();
    return NextResponse.json({ health, assessment: assessGpwCalendarHealth(health) }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({ error: "Nie udało się odczytać stanu kalendarza GPW." }, {
      status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
