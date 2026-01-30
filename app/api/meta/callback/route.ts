// app/api/meta/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function b64urlToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
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

async function exchangeCodeForToken(args: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}) {
  const url = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  url.searchParams.set("client_id", args.appId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("client_secret", args.appSecret);
  url.searchParams.set("code", args.code);

  const res = await fetch(url.toString(), { method: "GET" });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json) || `HTTP ${res.status}`;
    throw new Error(`Meta token exchange failed (${res.status}): ${msg}`);
  }
  return json as { access_token?: string; token_type?: string; expires_in?: number };
}

async function exchangeLongLived(args: {
  appId: string;
  appSecret: string;
  shortToken: string;
}) {
  const url = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", args.appId);
  url.searchParams.set("client_secret", args.appSecret);
  url.searchParams.set("fb_exchange_token", args.shortToken);

  const res = await fetch(url.toString(), { method: "GET" });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json) || `HTTP ${res.status}`;
    throw new Error(`Meta long-lived token exchange failed (${res.status}): ${msg}`);
  }
  return json as { access_token?: string; token_type?: string; expires_in?: number };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return NextResponse.json({ ok: false, error: `OAuth error: ${error}` }, { status: 400 });
    }
    if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
    if (!state) return NextResponse.json({ ok: false, error: "Missing state" }, { status: 400 });

    const secret = (process.env.META_STATE_SECRET || process.env.META_APP_SECRET || "").trim();
    if (!secret) throw new Error("Missing META_STATE_SECRET (or META_APP_SECRET)");

    const [payloadB64, sig] = state.split(".");
    if (!payloadB64 || !sig) {
      return NextResponse.json({ ok: false, error: "Invalid state format" }, { status: 400 });
    }

    const expectedSig = signState(payloadB64, secret);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return NextResponse.json({ ok: false, error: "Invalid state signature" }, { status: 400 });
    }

    const payloadJson = b64urlToString(payloadB64);
    const payload = JSON.parse(payloadJson) as { client_id: string; ts: number; nonce: string };

    if (!payload?.ts || Math.abs(Date.now() - payload.ts) > 10 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: "State expired. Please reconnect again." }, { status: 400 });
    }

    const clientId = payload.client_id;
    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id in state" }, { status: 400 });

    const appId = mustEnv("META_APP_ID");
    const appSecret = mustEnv("META_APP_SECRET");
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/meta/callback`;

    const shortTokenRes = await exchangeCodeForToken({ appId, appSecret, redirectUri, code });
    const shortToken = String(shortTokenRes.access_token || "");
    if (!shortToken) throw new Error("Meta token exchange failed: missing access_token");

    let accessToken = shortToken;
    try {
      const longRes = await exchangeLongLived({ appId, appSecret, shortToken });
      if (longRes?.access_token) accessToken = String(longRes.access_token);
    } catch (err) {
      console.warn("meta/callback long-lived token exchange failed, using short token", err);
    }

    const supabase = supabaseAdmin();

    const { data: updated, error: updErr } = await supabase
      .from("client_integrations")
      .update({
        meta_access_token: accessToken,
        meta_connected_at: new Date().toISOString(),
        status: "connected",
        is_active: true,
      })
      .eq("client_id", clientId)
      .eq("provider", "meta")
      .select("client_id, provider");

    if (updErr) throw updErr;

    if (!updated || updated.length === 0) {
      const { error: insErr } = await supabase.from("client_integrations").insert({
        client_id: clientId,
        provider: "meta",
        meta_access_token: accessToken,
        meta_connected_at: new Date().toISOString(),
        status: "connected",
        is_active: true,
      });
      if (insErr) throw insErr;
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Meta Connected</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px; }
      .card { max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
      .ok { color: #065f46; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="ok">✅ Meta Ads connected</div>
      <p>Access token saved for client:</p>
      <p><code>${clientId}</code></p>
      <p>You can close this tab and return to Settings.</p>
    </div>
  </body>
</html>`;

    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    console.error("meta/callback error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
