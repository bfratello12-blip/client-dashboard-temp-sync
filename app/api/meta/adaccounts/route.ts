// app/api/meta/adaccounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchMetaAdAccounts } from "@/lib/meta/adAccounts";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const shopDomain = req.nextUrl.searchParams.get("shop_domain")?.trim() || "";
    if (!shopDomain) {
      return NextResponse.json({ ok: false, error: "Missing shop_domain" }, { status: 400 });
    }
    const clientId = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from("client_integrations")
      .select("meta_access_token")
      .eq("client_id", clientId)
      .eq("provider", "meta")
      .limit(1);

    if (error) throw error;

    const token = String(data?.[0]?.meta_access_token ?? "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: "Meta not connected" }, { status: 400 });
    }

    const accounts = await fetchMetaAdAccounts({
      accessToken: token,
      apiVersion: process.env.META_API_VERSION || "v19.0",
    });

    return NextResponse.json({ ok: true, accounts });
  } catch (e: any) {
    console.error("meta/adaccounts error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
