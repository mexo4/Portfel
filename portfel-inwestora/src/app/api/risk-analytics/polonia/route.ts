import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { getPoloniaRates } from "@/lib/server/polonia";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  try {
    return NextResponse.json(await getPoloniaRates());
  } catch {
    return NextResponse.json(
      { error: "Stawka POLONIA jest chwilowo niedostępna." },
      { status: 503 }
    );
  }
}
