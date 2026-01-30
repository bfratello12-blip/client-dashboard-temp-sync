// app/api/integrations/status/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const PROVIDER_KEYS = ["provider", "type", "source", "kind", "integration", "name"];
const GOOGLE_HINT_KEYS = ["google_ads_customer_id", "google_customer_id", "customer_id", "ad_account_id"];
const META_HINT_KEYS = ["meta_ad_account_id", "ad_account_id", "account_id"];
const GOOGLE_TOKEN_KEYS = ["google_refresh_token", "refresh_token", "access_token"];
const META_TOKEN_KEYS = ["access_token", "refresh_token"];

const hasNonEmpty = (v: any) => v != null && String(v).trim().length > 0;

const valueIncludes = (v: any, needle: string) => {
  if (v == null) return false;
  return String(v).toLowerCase().includes(needle);
};

function rowMatchesProvider(row: Record<string, any>, needles: string[]) {
  return PROVIDER_KEYS.some((key) => {
    if (!(key in row)) return false;
    return needles.some((n) => valueIncludes(row[key], n));
  });
}

function rowHasAnyKey(row: Record<string, any>, keys: string[]) {
  return keys.some((key) => key in row && hasNonEmpty(row[key]));
}

function pickKey(row: Record<string, any>, keys: string[], regexes: RegExp[]) {
  for (const key of keys) {
    if (key in row) return key;
  }

  const rowKeys = Object.keys(row);
  for (const r of regexes) {
    const match = rowKeys.find((k) => r.test(k));
    if (match) return match;
  }

  return null;
}

function pickValue(row: Record<string, any>, keys: string[], regexes: RegExp[]) {
  const key = pickKey(row, keys, regexes);
  return key ? row[key] : null;
}

function redactRow(row: Record<string, any>) {
  const out: Record<string, any> = {};
  Object.keys(row).forEach((key) => {
    if (key.toLowerCase().includes("token")) {
      out[key] = { present: true, hasValue: hasNonEmpty(row[key]) };
      return;
    }
    out[key] = row[key];
  });
  return out;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("client_id")?.trim();
    const shopDomain = searchParams.get("shop_domain")?.trim();

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const shopifyQuery = admin
      .from("shopify_app_installs")
      .select("shop_domain, access_token")
      .eq("client_id", clientId)
      .limit(1);

    if (shopDomain) {
      shopifyQuery.eq("shop_domain", shopDomain);
    }

    const [shopifyRes, integrationsRes] = await Promise.all([
      shopifyQuery,
      admin.from("client_integrations").select("*").eq("client_id", clientId).limit(50),
    ]);

    if (shopifyRes.error) throw shopifyRes.error;
    if (integrationsRes.error) throw integrationsRes.error;

    const shopifyRow = shopifyRes.data?.[0] ?? null;
    const shopifyConnected = hasNonEmpty(shopifyRow?.access_token);
    const shopifyNeedsReconnect = Boolean(shopifyRow) && !shopifyConnected;

    const integrations = (integrationsRes.data ?? []) as Record<string, any>[];

    const debug = process.env.NODE_ENV !== "production" || searchParams.get("debug") === "1";
    if (debug) {
      const firstKeys = Object.keys(integrations?.[0] ?? {});
      const sample = integrations?.[0] ? redactRow(integrations[0]) : null;
      console.log("[integrations/status] client_integrations keys:", firstKeys);
      console.log("[integrations/status] client_integrations sample:", sample);
    }

    const googleRows = integrations.filter(
      (row) => rowMatchesProvider(row, ["google"]) || rowHasAnyKey(row, GOOGLE_HINT_KEYS)
    );

    const googleRow =
      googleRows.find((row) => {
        const token = pickValue(row, GOOGLE_TOKEN_KEYS, [/google.*refresh.*token/i, /refresh.*token/i, /access.*token/i]);
        const customerId = pickValue(row, GOOGLE_HINT_KEYS, [/google.*customer.*id/i, /customer.*id/i, /ad.*account.*id/i]);
        return hasNonEmpty(token) && hasNonEmpty(customerId);
      }) ??
      googleRows.find((row) => {
        const token = pickValue(row, GOOGLE_TOKEN_KEYS, [/google.*refresh.*token/i, /refresh.*token/i, /access.*token/i]);
        return hasNonEmpty(token);
      }) ??
      googleRows[0];

    const googleToken = googleRow
      ? pickValue(googleRow, GOOGLE_TOKEN_KEYS, [/google.*refresh.*token/i, /refresh.*token/i, /access.*token/i])
      : null;
    const googleCustomerId = googleRow
      ? pickValue(googleRow, GOOGLE_HINT_KEYS, [/google.*customer.*id/i, /customer.*id/i, /ad.*account.*id/i])
      : null;
    const googleConnected = hasNonEmpty(googleToken) && hasNonEmpty(googleCustomerId);

    const metaRows = integrations.filter(
      (row) => rowMatchesProvider(row, ["meta", "facebook", "fb"]) || rowHasAnyKey(row, META_HINT_KEYS)
    );
    const metaRow =
      metaRows.find((row) => {
        const token = pickValue(row, META_TOKEN_KEYS, [/access.*token/i, /refresh.*token/i]);
        const accountId = pickValue(row, META_HINT_KEYS, [/meta.*account.*id/i, /facebook.*account.*id/i, /fb.*account.*id/i, /account.*id/i]);
        return hasNonEmpty(token) && hasNonEmpty(accountId);
      }) ??
      metaRows.find((row) => {
        const token = pickValue(row, META_TOKEN_KEYS, [/access.*token/i, /refresh.*token/i]);
        return hasNonEmpty(token);
      }) ??
      metaRows[0];

    const metaToken = metaRow
      ? pickValue(metaRow, META_TOKEN_KEYS, [/access.*token/i, /refresh.*token/i])
      : null;
    const metaAccountId = metaRow
      ? pickValue(metaRow, META_HINT_KEYS, [/meta.*account.*id/i, /facebook.*account.*id/i, /fb.*account.*id/i, /account.*id/i])
      : null;
    const metaConnected = hasNonEmpty(metaToken) && hasNonEmpty(metaAccountId);

    return NextResponse.json({
      ok: true,
      client_id: clientId,
      shopify: {
        connected: shopifyConnected,
        needsReconnect: shopifyNeedsReconnect,
        shop: shopifyRow?.shop_domain ?? null,
      },
      google: {
        connected: googleConnected,
        hasToken: hasNonEmpty(googleToken),
        customerId: hasNonEmpty(googleCustomerId) ? String(googleCustomerId) : null,
      },
      meta: {
        connected: metaConnected,
        hasToken: hasNonEmpty(metaToken),
        accountId: hasNonEmpty(metaAccountId) ? String(metaAccountId) : null,
      },
    });
  } catch (e: any) {
    console.error("integrations/status error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
