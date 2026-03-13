import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeShopDomain(raw: string): string {
  const trimmed = String(raw || "").trim().toLowerCase();
  return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shop = normalizeShopDomain(searchParams.get("shop") || "");

    if (!shop) {
      return NextResponse.json({ ok: false, error: "Missing shop" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("clients")
      .select("id")
      .eq("shop_domain", shop)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const clientId = (data?.id ? String(data.id) : "").trim();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Client not found for shop" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, client_id: clientId, shop });
  } catch (e: any) {
    console.error("client-by-shop error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
