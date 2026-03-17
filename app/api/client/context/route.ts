import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeShopDomain(raw: string): string {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  return s.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = String(searchParams.get("client_id") || "").trim();

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const { data: install, error: installErr } = await admin
      .from("shopify_app_installs")
      .select("shop_domain")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (installErr) throw installErr;

    const shopDomain = normalizeShopDomain(String((install as any)?.shop_domain || ""));
    if (shopDomain) {
      return NextResponse.json({ ok: true, client_id: clientId, shop_domain: shopDomain });
    }

    const { data: client, error: clientErr } = await admin
      .from("clients")
      .select("shop_domain")
      .eq("id", clientId)
      .limit(1)
      .maybeSingle();

    if (clientErr) throw clientErr;

    const fallback = normalizeShopDomain(String((client as any)?.shop_domain || ""));
    if (!fallback) {
      return NextResponse.json({ ok: false, error: "shop_domain not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, client_id: clientId, shop_domain: fallback });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
