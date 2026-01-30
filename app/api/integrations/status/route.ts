// app/api/integrations/status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const GOOGLE_PROVIDER_VARIANTS = ["google", "google_ads", "googleads", "google-ads"];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("client_id")?.trim();

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const [shopifyRes, integrationsRes] = await Promise.all([
      admin.from("shopify_app_installs").select("shop, access_token").eq("client_id", clientId).limit(1),
      admin
        .from("client_integrations")
        .select(
          "provider, status, google_refresh_token, google_ads_customer_id, google_customer_id, meta_ad_account_id, meta_access_token, is_active"
        )
        .eq("client_id", clientId),
    ]);

    if (shopifyRes.error) throw shopifyRes.error;
    if (integrationsRes.error) throw integrationsRes.error;

    const shopifyRow = shopifyRes.data?.[0] ?? null;
    const shopifyConnected = Boolean(shopifyRow?.access_token);
    const shopifyNeedsReconnect = Boolean(shopifyRow) && !shopifyConnected;

    const integrations = integrationsRes.data ?? [];

    const googleConnected = integrations.some((row: any) => {
      const provider = String(row?.provider ?? "").toLowerCase();
      if (!GOOGLE_PROVIDER_VARIANTS.includes(provider)) return false;
      return Boolean(String(row?.google_refresh_token ?? "").trim());
    });

    const metaConnected = integrations.some((row: any) => {
      const provider = String(row?.provider ?? "").toLowerCase();
      if (provider !== "meta") return false;
      return Boolean(String(row?.meta_ad_account_id ?? "").trim()) && Boolean(String(row?.meta_access_token ?? "").trim());
    });

    return NextResponse.json({
      ok: true,
      client_id: clientId,
      shopify: {
        connected: shopifyConnected,
        needsReconnect: shopifyNeedsReconnect,
        shop: shopifyRow?.shop ?? null,
      },
      google: { connected: googleConnected },
      meta: { connected: metaConnected },
    });
  } catch (e: any) {
    console.error("integrations/status error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
