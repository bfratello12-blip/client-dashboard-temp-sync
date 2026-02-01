import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAuth(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
  if (!secret) return;
  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const token = req.nextUrl.searchParams.get("token")?.trim() || "";
  const ok = bearer === secret || token === secret || header === secret;
  if (!ok) throw new Error("Unauthorized");
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const payload = await req.json().catch(() => ({}));
    const clientId = String(payload?.client_id || "").trim();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "client_id required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin()
      .from("client_cost_settings")
      .upsert(payload, { onConflict: "client_id" });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
