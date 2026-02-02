import { NextRequest, NextResponse } from "next/server";

export function requireCronAuth(req: NextRequest): NextResponse | null {
  const expected = String(process.env.CRON_SECRET || "").trim();
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const qp = req.nextUrl.searchParams.get("token")?.trim() || "";

  if (!expected || (bearer !== expected && qp !== expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
