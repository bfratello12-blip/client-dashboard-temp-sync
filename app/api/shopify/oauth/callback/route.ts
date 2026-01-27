import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function safeTimingEqualHex(aHex: string, bHex: string) {
  // Shopify HMAC is hex. Compare as buffers + guard length mismatch.
  const a = Buffer.from(aHex, "utf8");
  const b = Buffer.from(bHex, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyShopifyHmac(params: URLSearchParams, secret: string) {
  const hmac = params.get("hmac");
  if (!hmac) return false;

  const msg = Array.from(params.entries())
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const digest = crypto.createHmac("sha256", secret).update(msg).digest("hex");
  return safeTimingEqualHex(digest, hmac);
}

async function shopifyGraphQL<T>(
  shop: string,
  accessToken: string,
  apiVersion: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(
      `Shopify GraphQL error: HTTP ${res.status}${
        json?.errors?.[0]?.message ? ` - ${json.errors[0].message}` : ""
      }`
    );
  }

  if (json?.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors[0].message}`);
  }

  return json.data as T;
}

async function registerMandatoryComplianceWebhooks(
  shop: string,
  accessToken: string,
  appUrl: string
) {
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-01";
  const callbackUrl = `${appUrl}/api/shopify/webhooks`; // must match your webhook route
  const topics = ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"] as const;

  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
      webhookSubscriptionCreate(
        topic: $topic
        webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
      ) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }
  `;

  for (const topic of topics) {
    const data = await shopifyGraphQL<{
      webhookSubscriptionCreate: {
        webhookSubscription: { id: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(shop, accessToken, apiVersion, mutation, { topic, callbackUrl });

    const errs = data.webhookSubscriptionCreate.userErrors || [];
    // If it already exists, Shopify may return a userError; ignore duplicates.
    const nonDuplicate = errs.filter((e) => !/already.*exists/i.test(e.message));
    if (nonDuplicate.length) {
      throw new Error(
        `Webhook subscription error (${topic}): ${nonDuplicate.map((e) => e.message).join("; ")}`
      );
    }
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const params = url.searchParams;

  const shop = params.get("shop");
  const code = params.get("code");
  const state = params.get("state");

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json({ ok: false, error: "Missing/invalid shop" }, { status: 400 });
  }
  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "Missing code/state" }, { status: 400 });
  }

  const apiKey = mustGetEnv("SHOPIFY_OAUTH_CLIENT_ID");
  const clientSecret = mustGetEnv("SHOPIFY_OAUTH_CLIENT_SECRET");
  const appUrl = mustGetEnv("SHOPIFY_APP_URL").replace(/\/$/, "");

  // 1) Verify HMAC
  if (!verifyShopifyHmac(params, clientSecret)) {
    return NextResponse.json({ ok: false, error: "Invalid HMAC" }, { status: 401 });
  }

  // 2) Verify state/nonce (cookie)
  const nonceCookie = req.cookies.get("shopify_oauth_nonce")?.value;
  if (!nonceCookie || nonceCookie !== state) {
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 401 });
  }

  // 3) Exchange code for access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenJson = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok) {
    return NextResponse.json(
      { ok: false, error: tokenJson?.error_description || "Token exchange failed" },
      { status: 500 }
    );
  }

  const accessToken = tokenJson?.access_token as string | undefined;
  const scopes = tokenJson?.scope as string | undefined;

  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "No access_token returned" }, { status: 500 });
  }

  // 4) Upsert into Supabase
  const supabase = createClient(
    mustGetEnv("SUPABASE_URL"),
    mustGetEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("id")
    .eq("shop", shop)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json({ ok: false, error: clientErr.message }, { status: 500 });
  }
  if (!clientRow?.id) {
    return NextResponse.json(
      { ok: false, error: `No client found for shop ${shop}. Create client first.` },
      { status: 400 }
    );
  }
  const client_id = String(clientRow.id);

  const nowISO = new Date().toISOString();
  const { error: integErr } = await supabase
    .from("client_integrations")
    .update({
      status: "connected",
      is_active: true,
      token_ref: accessToken,
      updated_at: nowISO,
    })
    .eq("client_id", client_id)
    .eq("provider", "shopify");
  if (integErr) {
    return NextResponse.json({ ok: false, error: integErr.message }, { status: 500 });
  }

  const { error } = await supabase.from("shopify_app_installs").upsert(
    {
      client_id,
      shop_domain: shop,
      access_token: accessToken,
      scopes,
      installed_at: nowISO,
      updated_at: nowISO,
    },
    { onConflict: "shop_domain" }
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // 5) Register mandatory compliance webhooks (required for Shopify review)
  try {
    await registerMandatoryComplianceWebhooks(shop, accessToken, appUrl);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Failed to register mandatory webhooks: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }

  // 6) Clear nonce + redirect
  const res = NextResponse.redirect(`${appUrl}/login?shopifyInstalled=1`);
  res.cookies.set("shopify_oauth_nonce", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}
