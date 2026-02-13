// app/api/integrations/status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const hasNonEmpty = (v: any) => v != null && String(v).trim().length > 0;
const isConnectedStatus = (status: any, isActive: any) => status === "connected" || isActive === true;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("client_id")?.trim();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const [shopifyRes, googleRes, metaRes] = await Promise.all([
      admin
        .from("client_integrations")
        .select("token_ref, status, is_active")
        .eq("client_id", clientId)
        .eq("provider", "shopify")
        .limit(1),
      admin
        .from("client_integrations")
        .select("google_refresh_token, google_ads_customer_id, google_customer_id, status, is_active")
        .eq("client_id", clientId)
        .eq("provider", "google_ads")
        .limit(1),
      admin
        .from("client_integrations")
        .select("meta_access_token, meta_ad_account_id, meta_ad_account_name, status, is_active")
        .eq("client_id", clientId)
        .eq("provider", "meta")
        .limit(1),
    ]);

    if (shopifyRes.error) throw shopifyRes.error;
    if (googleRes.error) throw googleRes.error;
    if (metaRes.error) throw metaRes.error;

    const shopifyRow = shopifyRes.data?.[0] ?? null;
    const shopifyToken = shopifyRow?.token_ref;
    const shopifyConnected = hasNonEmpty(shopifyToken) && isConnectedStatus(shopifyRow?.status, shopifyRow?.is_active);

    const googleRow = googleRes.data?.[0] ?? null;
    const googleToken = googleRow?.google_refresh_token;
    const googleCustomerId = googleRow?.google_customer_id ?? googleRow?.google_ads_customer_id ?? null;
    const googleConnected =
      hasNonEmpty(googleToken) && hasNonEmpty(googleCustomerId) && isConnectedStatus(googleRow?.status, googleRow?.is_active);

    const metaRow = metaRes.data?.[0] ?? null;
    const metaToken = metaRow?.meta_access_token;
    const metaAccountId = metaRow?.meta_ad_account_id;
    const metaAccountName = metaRow?.meta_ad_account_name;
    const metaConnected =
      hasNonEmpty(metaToken) && hasNonEmpty(metaAccountId) && isConnectedStatus(metaRow?.status, metaRow?.is_active);

    return NextResponse.json({
      ok: true,
      client_id: clientId,
      shopify: {
        connected: shopifyConnected,
        needsReconnect: Boolean(shopifyRow) && !shopifyConnected,
        shop: null,
      },
      google: {
        connected: googleConnected,
        hasToken: hasNonEmpty(googleToken),
        customerId: hasNonEmpty(googleCustomerId) ? String(googleCustomerId) : null,
      },
      meta: {
        connected: metaConnected,
        hasToken: hasNonEmpty(metaToken),
        accountId: hasNonEmpty(metaAccountId) ? String(metaAccountId) : null,
        accountName: hasNonEmpty(metaAccountName) ? String(metaAccountName) : null,
      },
    });
  } catch (e: any) {
    console.error("integrations/status error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
