// app/api/shopify/daily-summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function isDay(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function getBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const expected = process.env.SYNC_TOKEN || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
    if (!expected || token !== expected) {
      return NextResponse.json({ ok: false, source: "shopify", error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const shopDomain = (url.searchParams.get("shop_domain") || "").trim();
    const day = url.searchParams.get("day") || "";

    if (!shopDomain) return NextResponse.json({ ok: false, error: "Missing shop_domain" }, { status: 400 });
    const client_id = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!client_id || !isUUID(client_id)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!isDay(day)) return NextResponse.json({ ok: false, error: "Invalid day" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("daily_metrics")
      .select("client_id, date, revenue, orders")
      .eq("client_id", client_id)
      .eq("date", day)
      .eq("source", "shopify")
      .maybeSingle();

    if (error) throw error;

    const revenue = Number(data?.revenue ?? 0);
    const orders = Number(data?.orders ?? 0);

    return NextResponse.json({
      ok: true,
      source: "shopify",
      client_id,
      day,
      revenue,
      orders,
      units: null,
      aov: orders > 0 ? revenue / orders : 0,
      asp: null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, source: "shopify", error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}












