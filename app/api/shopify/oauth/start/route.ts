import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

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
  const clientId = (url.searchParams.get("client_id") || "").trim();

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json(
      { ok: false, error: "Missing/invalid shop (must be *.myshopify.com)" },
      { status: 400 }
    );
  }
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
  }

  // Your env names (keep as-is if that’s what you’re using)
  const apiKey = mustGetEnv("SHOPIFY_OAUTH_CLIENT_ID");
  const appUrl = mustGetEnv("SHOPIFY_APP_URL").replace(/\/$/, "");
  const scopesRaw =
    process.env.SHOPIFY_SCOPES ||
    "read_all_orders,read_orders,read_inventory,read_reports,read_products";
  const scopes = scopesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log("[oauth/start] scopes used:", scopes);

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ client_id: clientId, nonce })).toString("base64url");

  const redirectUri = `${appUrl}/api/shopify/oauth/callback`;

  // ✅ Standard OAuth authorize endpoint on the shop domain (NOT admin.shopify.com)
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", apiKey);
  authUrl.searchParams.set("scope", scopes.join(","));
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  console.log("[oauth/start] authorize URL:", authUrl.toString());

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
