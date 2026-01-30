// app/api/integrations/status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const PROVIDER_KEYS = ["provider", "type", "source", "kind", "integration"];
const GOOGLE_HINT_KEYS = ["google_ads_customer_id", "customer_id", "ad_account_id"];
const META_HINT_KEYS = ["meta_ad_account_id", "ad_account_id", "account_id"];
const TOKEN_KEYS = ["access_token", "refresh_token"];

const hasNonEmpty = (v: any) => v != null && String(v).trim().length > 0;

const valueIncludes = (v: any, needle: string) => {
  if (v == null) return false;
  return String(v).toLowerCase().includes(needle);
};

function rowMatchesProvider(row: Record<string, any>, needles: string[]) {
  return PROVIDER_KEYS.some((key) => {
    if (!(key in row)) return false;
    return needles.some((n) => valueIncludes(row[key], n));
  });
}

function rowHasAnyKey(row: Record<string, any>, keys: string[]) {
  return keys.some((key) => key in row && hasNonEmpty(row[key]));
}

function rowHasTokenAndHint(row: Record<string, any>, needles: string[]) {
  const hasToken = TOKEN_KEYS.some((key) => key in row && hasNonEmpty(row[key]));
  if (!hasToken) return false;

  return Object.keys(row).some((key) => {
    if (TOKEN_KEYS.includes(key)) return false;
    return needles.some((n) => valueIncludes(row[key], n));
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("client_id")?.trim();
    const shopDomain = searchParams.get("shop_domain")?.trim();

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const shopifyQuery = admin
      .from("shopify_app_installs")
      .select("shop_domain, access_token")
      .eq("client_id", clientId)
      .limit(1);

    if (shopDomain) {
      shopifyQuery.eq("shop_domain", shopDomain);
    }

    const [shopifyRes, integrationsRes] = await Promise.all([
      shopifyQuery,
      admin.from("client_integrations").select("*").eq("client_id", clientId).limit(50),
    ]);

    if (shopifyRes.error) throw shopifyRes.error;
    if (integrationsRes.error) throw integrationsRes.error;

    const shopifyRow = shopifyRes.data?.[0] ?? null;
    const shopifyConnected = hasNonEmpty(shopifyRow?.access_token);
    const shopifyNeedsReconnect = Boolean(shopifyRow) && !shopifyConnected;

    const integrations = (integrationsRes.data ?? []) as Record<string, any>[];

    if (process.env.NODE_ENV !== "production") {
      const firstKeys = Object.keys(integrations?.[0] ?? {});
      console.log("[integrations/status] first client_integrations keys:", firstKeys);
    }

    const googleConnected = integrations.some((row) => {
      if (rowMatchesProvider(row, ["google"])) return true;
      if (rowHasAnyKey(row, GOOGLE_HINT_KEYS)) return true;
      if (rowHasTokenAndHint(row, ["google"])) return true;
      return false;
    });

    const metaConnected = integrations.some((row) => {
      if (rowMatchesProvider(row, ["meta", "facebook", "fb"])) return true;
      if (rowHasAnyKey(row, META_HINT_KEYS)) return true;
      if (rowHasTokenAndHint(row, ["meta", "facebook", "fb"])) return true;
      return false;
    });

    return NextResponse.json({
      ok: true,
      client_id: clientId,
      shopify: {
        connected: shopifyConnected,
        needsReconnect: shopifyNeedsReconnect,
        shop: shopifyRow?.shop_domain ?? null,
      },
      google: { connected: googleConnected },
      meta: { connected: metaConnected },
    });
  } catch (e: any) {
    console.error("integrations/status error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
