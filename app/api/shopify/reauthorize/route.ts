import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

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

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json(
      { ok: false, error: "Missing/invalid shop (must be *.myshopify.com)" },
      { status: 400 }
    );
  }

  const supabase = createClient(
    mustGetEnv("SUPABASE_URL"),
    mustGetEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  const { data: integ, error: integErr } = await supabase
    .from("client_integrations")
    .select("client_id, shop_domain")
    .eq("provider", "shopify")
    .eq("shop_domain", shop)
    .maybeSingle();

  if (integErr) {
    return NextResponse.json({ ok: false, error: integErr.message }, { status: 500 });
  }
  if (!integ?.client_id) {
    return NextResponse.json(
      { ok: false, error: `No client found for shop ${shop}. Create client first.` },
      { status: 400 }
    );
  }

  const apiKey = mustGetEnv("SHOPIFY_API_KEY");
  const appUrl = mustGetEnv("SHOPIFY_APP_URL").replace(/\/$/, "");
  const scopesRaw =
    process.env.SHOPIFY_SCOPES ||
    "read_all_orders,read_orders,read_inventory,read_reports,read_products";
  const scopes = scopesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!scopes.includes("read_products")) scopes.push("read_products");

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(
    JSON.stringify({ client_id: String(integ.client_id), nonce })
  ).toString("base64url");

  const redirectUri = `${appUrl}/api/shopify/oauth/callback`;

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", apiKey);
  authUrl.searchParams.set("scope", scopes.join(","));
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());

  res.cookies.set("shopify_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  return res;
}
