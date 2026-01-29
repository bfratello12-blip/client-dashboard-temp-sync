import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function normalizeShop(shop: string) {
  const s = shop.trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const shop = normalizeShop(url.searchParams.get("shop") || "");
  const clientId = url.searchParams.get("client_id") || process.env.DEFAULT_CLIENT_ID || "";
  const referer = req.headers.get("referer") || "";
  const origin = req.headers.get("origin") || "";
  const appBaseUrl = mustGetEnv("APP_BASE_URL").replace(/\/$/, "");
  const appBaseHost = new URL(appBaseUrl).host;
  const originHost = origin ? new URL(origin).host : "";
  const isAdminReferer = /admin\.shopify\.com/i.test(referer);
  const isAppBaseOrigin = !!originHost && originHost === appBaseHost;
  const hasRefererAdmin = referer.includes("https://admin.shopify.com/");
  const hasHostParam = url.searchParams.has("host");
  const hasIdTokenParam = url.searchParams.has("id_token");
  const embeddedParam = url.searchParams.get("embedded") || "";

  console.info("[oauth/start] HIT", {
    ts: new Date().toISOString(),
    shop,
    referer,
    origin,
  });

  // Guard: allow internal requests or Shopify Admin app-open flow.
  const internalRequest = req.headers.get("x-internal-request") === "1";
  const allowed =
    internalRequest ||
    (shop &&
      (isAdminReferer ||
        isAppBaseOrigin ||
        hasRefererAdmin ||
        hasHostParam ||
        hasIdTokenParam ||
        embeddedParam === "1"));
  if (!allowed) {
    console.warn("[oauth/start] blocked", {
      shop,
      referer,
      origin,
      hasRefererAdmin,
      hasHostParam,
      hasIdTokenParam,
      embeddedParam,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { ok: false, error: "oauth/start blocked" },
      { status: 403 }
    );
  }

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json(
      { ok: false, error: "Missing/invalid shop (must be *.myshopify.com)" },
      { status: 400 }
    );
  }
  if (!clientId) {
    console.warn("[oauth/start] missing client_id", {
      shop,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ ok: false, error: "missing client_id" }, { status: 400 });
  }
  // Your env names (keep as-is if that’s what you’re using)
  const apiKey = mustGetEnv("SHOPIFY_API_KEY"); // equals SHOPIFY_OAUTH_CLIENT_ID
  const scopesRaw =
    process.env.SHOPIFY_SCOPES ||
    "read_all_orders,read_orders,read_inventory,read_reports,read_products";
  const scopes = scopesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const nonce = crypto.randomBytes(16).toString("hex");
  const { data: stateRow, error: stateErr } = await supabaseAdmin()
    .from("shopify_oauth_states")
    .insert({ shop_domain: shop, nonce, client_id: clientId })
    .select("id")
    .maybeSingle();
  if (stateErr || !stateRow?.id) {
    return NextResponse.json(
      { ok: false, error: stateErr?.message || "Failed to create OAuth state" },
      { status: 500 }
    );
  }
  const state = String(stateRow.id);
  console.log("[oauth/start] created state id:", state);

  const redirectUri = `${appBaseUrl}/api/shopify/oauth/callback`;

  // ✅ Standard OAuth authorize endpoint on the shop domain (NOT admin.shopify.com)
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", apiKey);
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  console.log("[oauth/start] authorize URL:", authUrl.toString());

  return NextResponse.redirect(authUrl.toString());
}
