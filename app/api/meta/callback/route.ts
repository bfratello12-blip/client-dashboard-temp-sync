// app/api/meta/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchMetaAdAccounts, normalizeMetaAdAccountId } from "@/lib/meta/adAccounts";

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConnectedPage(options: {
  title: string;
  tokenLabel: string;
  clientId: string;
  footerMessage: string;
  redirectUrl: string;
  delayMs?: number;
}) {
  const { title, tokenLabel, clientId, footerMessage, redirectUrl, delayMs = 10000 } = options;
  const safeTitle = escapeHtml(title);
  const safeTokenLabel = escapeHtml(tokenLabel);
  const safeClientId = escapeHtml(clientId);
  const safeFooterMessage = escapeHtml(footerMessage);
  const safeRedirectUrl = JSON.stringify(redirectUrl);
  const safeDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 10000;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 24px;
        background: #f3f4f6;
        color: #111827;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial;
      }
      .card {
        width: min(680px, 100%);
        margin-top: 56px;
        border: 1px solid #d1d5db;
        border-radius: 12px;
        background: #f3f4f6;
        padding: 24px;
      }
      .ok {
        color: #065f46;
        font-size: 30px;
        line-height: 1;
        margin-right: 10px;
      }
      .title-row {
        display: flex;
        align-items: center;
        margin-bottom: 12px;
      }
      .title {
        color: #065f46;
        font-size: 30px;
        font-weight: 700;
        margin: 0;
      }
      p {
        margin: 0 0 14px;
        font-size: 31px;
        line-height: 1.35;
      }
      code {
        background: #e5e7eb;
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 26px;
      }
      .countdown {
        font-size: 26px;
        margin-top: 4px;
      }
      a {
        color: #1f2937;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="title-row">
        <div class="ok">✓</div>
        <h1 class="title">${safeTitle}</h1>
      </div>
      <p>${safeTokenLabel}</p>
      <p><code>${safeClientId}</code></p>
      <p>${safeFooterMessage}</p>
      <p class="countdown">Returning to Settings in <span id="countdown">${Math.ceil(safeDelayMs / 1000)}</span>s. <a id="redirect-link" href="#">Go now</a>.</p>
    </div>
    <script>
      const redirectUrl = ${safeRedirectUrl};
      const delayMs = ${safeDelayMs};
      const countdownEl = document.getElementById("countdown");
      const redirectLinkEl = document.getElementById("redirect-link");

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
    const payload = JSON.parse(payloadJson) as { client_id: string; shop_domain?: string; ts: number; nonce: string };

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

    let autoSelectedAccount: { id: string; name?: string } | null = null;
    try {
      const accounts = await fetchMetaAdAccounts({
        accessToken,
        apiVersion: process.env.META_API_VERSION || "v19.0",
      });

      if (accounts.length === 1) {
        const acct = accounts[0];
        const normalizedId = normalizeMetaAdAccountId(acct.id);
        autoSelectedAccount = { id: normalizedId, name: acct.name };

        const { data: rows, error: rowErr } = await supabase
          .from("client_integrations")
          .select("*")
          .eq("client_id", clientId)
          .eq("provider", "meta")
          .limit(1);

        if (rowErr) throw rowErr;
        const row = (rows?.[0] as Record<string, any> | undefined) ?? null;

        if (row) {
          const update: Record<string, any> = { meta_ad_account_id: normalizedId };
          if (acct.name && "meta_ad_account_name" in row) update.meta_ad_account_name = acct.name;
          const { error: updAcctErr } = await supabase
            .from("client_integrations")
            .update(update)
            .eq("client_id", clientId)
            .eq("provider", "meta");
          if (updAcctErr) throw updAcctErr;
        } else {
          const baseInsert: Record<string, any> = {
            client_id: clientId,
            provider: "meta",
            meta_access_token: accessToken,
            meta_connected_at: new Date().toISOString(),
            status: "connected",
            is_active: true,
            meta_ad_account_id: normalizedId,
          };
          if (acct.name) {
            const { error: insErr } = await supabase.from("client_integrations").insert({
              ...baseInsert,
              meta_ad_account_name: acct.name,
            });
            if (insErr) {
              const { error: retryErr } = await supabase.from("client_integrations").insert(baseInsert);
              if (retryErr) throw retryErr;
            }
          } else {
            const { error: insErr } = await supabase.from("client_integrations").insert(baseInsert);
            if (insErr) throw insErr;
          }
        }
      }
    } catch (err) {
      console.warn("meta/callback adaccounts fetch failed:", err);
    }

    const settingsUrl = new URL("/settings", origin);
    const shopDomain = String(payload.shop_domain || "").trim();
    if (shopDomain) settingsUrl.searchParams.set("shop", shopDomain);

    return renderConnectedPage({
      title: "Meta Ads connected",
      tokenLabel: "Access token saved for client:",
      clientId,
      footerMessage: autoSelectedAccount
        ? `Ad account auto-selected: ${autoSelectedAccount.id}. Returning to Settings.`
        : "Select an ad account in Settings to finish setup.",
      redirectUrl: settingsUrl.toString(),
      delayMs: 10000,
    });
  } catch (e: any) {
    console.error("meta/callback error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
