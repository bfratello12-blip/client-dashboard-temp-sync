// app/api/googleads/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function getOAuthClientId(): string {
  return (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
}
function getOAuthClientSecret(): string {
  return (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

function b64urlToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}

function signState(payloadB64: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();
  if (!clientId) throw new Error("Missing GOOGLE_ADS_CLIENT_ID (or GOOGLE_CLIENT_ID)");
  if (!clientSecret) throw new Error("Missing GOOGLE_ADS_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = json?.error_description || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`Token exchange failed (${res.status}): ${msg}`);
  }

  return json as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");

    if (err) {
      return NextResponse.json({ ok: false, error: `OAuth error: ${err}` }, { status: 400 });
    }
    if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
    if (!state) return NextResponse.json({ ok: false, error: "Missing state" }, { status: 400 });

    const secret = mustEnv("OAUTH_STATE_SECRET");

    const [payloadB64, sig] = state.split(".");
    if (!payloadB64 || !sig) return NextResponse.json({ ok: false, error: "Invalid state format" }, { status: 400 });

    const expectedSig = signState(payloadB64, secret);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return NextResponse.json({ ok: false, error: "Invalid state signature" }, { status: 400 });
    }

    const payloadJson = b64urlToString(payloadB64);
    const payload = JSON.parse(payloadJson) as {
      client_id: string;
      shop_domain?: string;
      ts: number;
      nonce: string;
    };

    // 10 minute window
    if (!payload?.ts || Math.abs(Date.now() - payload.ts) > 10 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: "State expired. Please reconnect again." }, { status: 400 });
    }

    const clientId = payload.client_id;
    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id in state" }, { status: 400 });
    console.log("GOOGLE CALLBACK verified client_id", clientId);

    const redirectUri = `${url.origin}/api/googleads/callback`;
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refresh_token) {
      // This happens if Google decides not to re-issue a refresh token.
      // Our /connect forces prompt=consent + access_type=offline, but if the user cancelled and re-ran,
      // or the OAuth client is misconfigured, you can still hit this.
      return NextResponse.json(
        {
          ok: false,
          error: "No refresh_token returned. Make sure your OAuth client is set to 'External' (if needed) and /connect uses prompt=consent.",
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    console.log("UPSERT client_id", clientId);
    // Try update first (handles existing row).
    const { data: updated, error: updErr } = await supabase
      .from("client_integrations")
      .update({
        google_refresh_token: tokens.refresh_token,
        status: "connected",
        google_connected_at: new Date().toISOString(),
        is_active: true,
      })
      .eq("client_id", clientId)
      .eq("provider", "google_ads")
      .select("client_id, provider");

    if (updErr) throw updErr;

    if (!updated || updated.length === 0) {
      // If no existing row, insert a minimal one.
      const { error: insErr } = await supabase.from("client_integrations").insert({
        client_id: clientId,
        provider: "google_ads",
        status: "connected",
        google_connected_at: new Date().toISOString(),
        is_active: true,
        google_refresh_token: tokens.refresh_token,
      });
      if (insErr) throw insErr;
    }

    // Return a friendly HTML page for browser-based OAuth flow.
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Connected</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; padding: 24px; }
      .card { max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
      .ok { color: #065f46; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="ok">✅ Google Ads connected</div>
      <p>Refresh token saved for client:</p>
      <p><code>${clientId}</code></p>
      <p>Verified state client_id: <code>${clientId}</code></p>
      <p>Upserted client_id: <code>${clientId}</code></p>
      <p>You can close this tab and run your Google sync.</p>
    </div>
  </body>
</html>`;
    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    console.error("googleads/callback error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}