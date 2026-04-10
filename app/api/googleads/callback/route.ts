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

function getOAuthRedirectUri(origin: string): string {
  const configured = (process.env.GOOGLE_ADS_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || "").trim();
  if (configured) return configured;
  return `${origin}/api/googleads/callback`;
}

function b64urlToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}

function signState(payloadB64: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function renderRedirectPage(options: { title: string; message: string; redirectUrl: string; delayMs?: number }) {
  const { title, message, redirectUrl, delayMs = 10000 } = options;
  const safeTitle = JSON.stringify(title);
  const safeMessage = JSON.stringify(message);
  const safeRedirectUrl = JSON.stringify(redirectUrl);
  const safeDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 10000;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f8fafc;
        --panel: #ffffff;
        --text: #0f172a;
        --muted: #475569;
        --accent: #2563eb;
        --border: rgba(15, 23, 42, 0.08);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(37, 99, 235, 0.14), transparent 36%),
          linear-gradient(180deg, #eff6ff 0%, var(--bg) 42%, #ffffff 100%);
        color: var(--text);
        font-family: Georgia, "Times New Roman", serif;
      }
      main {
        width: min(560px, 100%);
        padding: 36px 32px;
        border: 1px solid var(--border);
        border-radius: 24px;
        background: color-mix(in srgb, var(--panel) 88%, white 12%);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2rem, 4vw, 2.8rem);
        line-height: 1.05;
        letter-spacing: -0.03em;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 1.05rem;
        line-height: 1.7;
      }
      .timer {
        margin-top: 28px;
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        border-radius: 999px;
        background: rgba(37, 99, 235, 0.08);
        color: var(--accent);
        font-weight: 600;
      }
      .bar {
        margin-top: 28px;
        width: 100%;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(37, 99, 235, 0.12);
      }
      .bar > span {
        display: block;
        width: 100%;
        height: 100%;
        transform-origin: left center;
        background: linear-gradient(90deg, #60a5fa 0%, #2563eb 100%);
        animation: shrink ${safeDelayMs}ms linear forwards;
      }
      a {
        color: var(--accent);
      }
      @keyframes shrink {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
    </style>
  </head>
  <body>
    <main>
      <h1 id="title"></h1>
      <p id="message"></p>
      <div class="timer">
        Redirecting in <span id="countdown">${Math.ceil(safeDelayMs / 1000)}</span>s
      </div>
      <div class="bar" aria-hidden="true"><span></span></div>
      <p style="margin-top: 20px; font-size: 0.95rem;">
        If you are not redirected automatically, <a id="redirect-link" href="#">return to settings</a>.
      </p>
    </main>
    <script>
      const title = ${safeTitle};
      const message = ${safeMessage};
      const redirectUrl = ${safeRedirectUrl};
      const delayMs = ${safeDelayMs};
      const countdownEl = document.getElementById("countdown");
      const titleEl = document.getElementById("title");
      const messageEl = document.getElementById("message");
      const redirectLinkEl = document.getElementById("redirect-link");

      if (titleEl) titleEl.textContent = title;
      if (messageEl) messageEl.textContent = message;
      if (redirectLinkEl) redirectLinkEl.href = redirectUrl;

      const startedAt = Date.now();
      const updateCountdown = () => {
        if (!countdownEl) return;
        const remainingMs = Math.max(0, delayMs - (Date.now() - startedAt));
        countdownEl.textContent = String(Math.ceil(remainingMs / 1000));
      };

      const performRedirect = () => {
        if (window.top && window.top !== window) {
          window.top.location.href = redirectUrl;
          return;
        }
        window.location.href = redirectUrl;
      };

      updateCountdown();
      const intervalId = window.setInterval(updateCountdown, 250);
      window.setTimeout(() => {
        window.clearInterval(intervalId);
        performRedirect();
      }, delayMs);
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
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
      shop_domain: string;
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

    const origin = req.nextUrl.origin;
    const redirectUri = getOAuthRedirectUri(origin);
    console.log("[googleads/callback] origin=", origin, "redirect_uri=", redirectUri);
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

    // Redirect back to settings page with shop_domain param
    const settingsUrl = new URL("/settings", origin);
    settingsUrl.searchParams.set("shop", payload.shop_domain);
    return renderRedirectPage({
      title: "Google Ads connected",
      message: "OAuth consent finished successfully. This page will return you to settings automatically.",
      redirectUrl: settingsUrl.toString(),
      delayMs: 10000,
    });
  } catch (e: any) {
    console.error("googleads/callback error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}