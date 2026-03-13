import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeShopDomain(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shop = normalizeShopDomain(searchParams.get("shop") || "");

    if (!shop) {
      return NextResponse.json({ error: "missing shop parameter" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("shopify_app_installs")
      .select("client_id")
      .eq("shop_domain", shop)
      .limit(1)
      .maybeSingle();

    if (error || !data?.client_id) {
      return NextResponse.json({ error: "client not found for shop" }, { status: 404 });
    }

    return NextResponse.json({ client_id: String(data.client_id) });
  } catch (e: any) {
    console.error("client resolve error:", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
