import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseUserFromRequest,
  isConfiguredAdminEmail,
  supabaseUserHasClientAccess,
} from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const clientId = String(req.nextUrl.searchParams.get("client_id") || "").trim();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const user = await getSupabaseUserFromRequest(req);
    if (!user?.id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (isConfiguredAdminEmail(user.email)) {
      return NextResponse.json({ ok: true, authorized: true, mode: "global-admin" });
    }

    const hasMappedAccess = await supabaseUserHasClientAccess(user.id, clientId);
    if (hasMappedAccess) {
      return NextResponse.json({ ok: true, authorized: true, mode: "user-client" });
    }

    const allowMultiClientAdmin =
      String(process.env.NEXT_PUBLIC_ALLOW_MULTI_CLIENT_ADMIN || "").trim().toLowerCase() === "true";
    const projectDefaultClientId = String(process.env.DEFAULT_CLIENT_ID || "").trim();
    if (allowMultiClientAdmin && projectDefaultClientId && projectDefaultClientId === clientId) {
      return NextResponse.json({ ok: true, authorized: true, mode: "project-default" });
    }

    return NextResponse.json({ ok: true, authorized: false, mode: "none" }, { status: 403 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
