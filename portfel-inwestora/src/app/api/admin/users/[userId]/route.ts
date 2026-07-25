import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/server/access";
import { deleteUserByAdmin, getCurrentAccountData } from "@/lib/server/auth";

export const runtime = "nodejs";

type AdminUserRouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function DELETE(_request: Request, context: AdminUserRouteContext) {
  const accountData = await getCurrentAccountData();

  if (!accountData || !isAdminEmail(accountData.user.email)) {
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
