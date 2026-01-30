// app/api/meta/connect/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function base64url(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signState(payloadB64: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get("client_id")?.trim();
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const appId = mustEnv("META_APP_ID");
    const secret = (process.env.META_STATE_SECRET || process.env.META_APP_SECRET || "").trim();
    if (!secret) throw new Error("Missing META_STATE_SECRET (or META_APP_SECRET)");

    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/meta/callback`;

    const payload = {
      client_id: clientId,
      ts: Date.now(),
      nonce: crypto.randomBytes(12).toString("hex"),
    };

    const payloadB64 = base64url(JSON.stringify(payload));
    const sig = signState(payloadB64, secret);
    const state = `${payloadB64}.${sig}`;

    const authUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
    authUrl.searchParams.set("client_id", appId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "ads_read,business_management");

    return NextResponse.redirect(authUrl.toString());
  } catch (e: any) {
    console.error("meta/connect error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
