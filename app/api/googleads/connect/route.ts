// app/api/googleads/connect/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates an OAuth authorization URL for Google Ads and redirects the browser there.
 *
 * Usage (production or local):
 *   GET /api/googleads/connect?client_id=<your-client-uuid>
 *
 * Prereqs:
 * - In Google Cloud Console OAuth client, add redirect URI:
 *   https://<your-domain>/api/googleads/callback
 * - Env vars (support both naming conventions):
 *   GOOGLE_ADS_CLIENT_ID or GOOGLE_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET or GOOGLE_CLIENT_SECRET
 * - CRON_SECRET (used to sign/validate state)
 */
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function getOAuthClientId(): string {
  return (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
}

function getOAuthRedirectUri(origin: string): string {
  const configured = (process.env.GOOGLE_ADS_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || "").trim();
  if (configured) return configured;
  return `${origin}/api/googleads/callback`;
}

function base64url(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signState(payloadB64: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const shopDomain = url.searchParams.get("shop_domain")?.trim() || "";
    if (!shopDomain) {
      return NextResponse.json({ ok: false, error: "missing shop_domain" }, { status: 400 });
    }
    const clientId = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!clientId) {
      throw new Error("client_id is required for Google OAuth");
    }
    console.log("GOOGLE CONNECT received client_id", clientId);
    console.log("GOOGLE CONNECT FINAL client_id", clientId);

    const oauthClientId = getOAuthClientId();
    if (!oauthClientId) throw new Error("Missing GOOGLE_ADS_CLIENT_ID (or GOOGLE_CLIENT_ID)");

    const secret = mustEnv("OAUTH_STATE_SECRET");

    // Redirect URI must match Google Cloud Console exactly.
    const origin = req.nextUrl.origin;
    const redirectUri = getOAuthRedirectUri(origin);
    console.log("[googleads/connect] origin=", origin, "redirect_uri=", redirectUri);

    const payload = {
      client_id: clientId,
      ts: Date.now(),
      nonce: crypto.randomBytes(12).toString("hex"),
    };
    console.log("GOOGLE CONNECT building state client_id", payload.client_id);

    const payloadB64 = base64url(JSON.stringify(payload));
    const sig = signState(payloadB64, secret);
    const state = `${payloadB64}.${sig}`;

    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", oauthClientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("include_granted_scopes", "true");
    auth.searchParams.set("state", state);

    return NextResponse.json({ url: auth.toString() });
  } catch (e: any) {
    console.error("googleads/connect error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}