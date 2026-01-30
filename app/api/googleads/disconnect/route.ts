// app/api/googleads/disconnect/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hasKey = (row: Record<string, any> | null, key: string) => row && key in row;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const clientId = String(body?.client_id ?? "").trim();

    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });

    const supabase = supabaseAdmin();

    const { data: rows, error } = await supabase
      .from("client_integrations")
      .select("*")
      .eq("client_id", clientId)
      .eq("provider", "google_ads")
      .limit(1);

    if (error) throw error;

    const row = (rows?.[0] as Record<string, any> | undefined) ?? null;
    if (!row) return NextResponse.json({ ok: true, updated: false });

    const update: Record<string, any> = {
      status: "disconnected",
      google_refresh_token: null,
      google_ads_customer_id: null,
    };

    if (hasKey(row, "google_connected_at")) update.google_connected_at = null;
    if (hasKey(row, "access_token")) update.access_token = null;
    if (hasKey(row, "refresh_token")) update.refresh_token = null;
    if (hasKey(row, "token_expiry")) update.token_expiry = null;
    if (hasKey(row, "expires_at")) update.expires_at = null;
    if (hasKey(row, "google_access_token")) update.google_access_token = null;

    const { error: updErr } = await supabase
      .from("client_integrations")
      .update(update)
      .eq("client_id", clientId)
      .eq("provider", "google_ads");

    if (updErr) throw updErr;

    return NextResponse.json({ ok: true, updated: true });
  } catch (e: any) {
    console.error("googleads/disconnect error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
