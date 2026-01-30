// app/api/googleads/select-account/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hasNonEmpty = (v: any) => v != null && String(v).trim().length > 0;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const clientId = String(body?.client_id ?? "").trim();
    const googleAdsCustomerId = String(body?.google_ads_customer_id ?? "").trim();

    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    if (!googleAdsCustomerId) {
      return NextResponse.json({ ok: false, error: "Missing google_ads_customer_id" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data: rows, error } = await supabase
      .from("client_integrations")
      .select("*")
      .eq("client_id", clientId)
      .eq("provider", "google_ads")
      .limit(1);

    if (error) throw error;

    const integration = (rows?.[0] as Record<string, any> | undefined) ?? null;

    if (integration) {
      const updatePayload: Record<string, any> = {
        google_ads_customer_id: googleAdsCustomerId,
        google_customer_id: googleAdsCustomerId,
      };
      if ("status" in integration && !hasNonEmpty(integration.status)) updatePayload.status = "connected";
      if ("is_active" in integration && integration.is_active !== true) updatePayload.is_active = true;

      const { error: updErr } = await supabase
        .from("client_integrations")
        .update(updatePayload)
        .eq("client_id", clientId)
        .eq("provider", "google_ads");
      if (updErr) throw updErr;

      return NextResponse.json({ ok: true, updated: true });
    }

    const insertPayload: Record<string, any> = {
      client_id: clientId,
      provider: "google_ads",
      google_ads_customer_id: googleAdsCustomerId,
      google_customer_id: googleAdsCustomerId,
      status: "connected",
      is_active: true,
    };

    const { error: insErr } = await supabase.from("client_integrations").insert(insertPayload);
    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, inserted: true });
  } catch (e: any) {
    console.error("googleads/select-account error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
