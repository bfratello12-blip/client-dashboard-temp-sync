// app/api/googleads/accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hasNonEmpty = (v: any) => v != null && String(v).trim().length > 0;

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

function getOAuthClientId(): string {
  return (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
}
function getOAuthClientSecret(): string {
  return (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();
  if (!clientId) throw new Error("Missing GOOGLE_ADS_CLIENT_ID (or GOOGLE_CLIENT_ID)");
  if (!clientSecret) throw new Error("Missing GOOGLE_ADS_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)");

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${JSON.stringify(json).slice(0, 500)}`);
  }

  const accessToken = String(json?.access_token || "");
  if (!accessToken) throw new Error("Google OAuth token refresh failed: missing access_token");
  return accessToken;
}

function normalizeCustomerId(v: string) {
  return String(v || "").replace(/-/g, "").trim();
}

async function fetchCustomerName(args: {
  accessToken: string;
  developerToken: string;
  customerId: string;
  managerCustomerId?: string;
}) {
  const { accessToken, developerToken, customerId, managerCustomerId } = args;
  const query = "SELECT customer.id, customer.descriptive_name FROM customer";
  const url = `https://googleads.googleapis.com/v22/customers/${encodeURIComponent(normalizeCustomerId(customerId))}/googleAds:search`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "content-type": "application/json",
  };
  if (managerCustomerId) headers["login-customer-id"] = normalizeCustomerId(managerCustomerId);

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const row = json?.results?.[0]?.customer ?? json?.results?.[0]?.customerCustomer ?? null;
  const name = row?.descriptiveName ?? row?.descriptive_name ?? null;
  return name ? String(name) : null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get("client_id")?.trim();
    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });

    const supabase = supabaseAdmin();
    const { data: rows, error } = await supabase
      .from("client_integrations")
      .select("*")
      .eq("client_id", clientId)
      .eq("provider", "google_ads")
      .limit(50);

    if (error) throw error;

    const integrations = (rows ?? []) as Record<string, any>[];
    const googleRow = integrations[0];

    if (!googleRow) {
      return NextResponse.json({ ok: false, error: "Google integration not found" }, { status: 404 });
    }

    const refreshToken = pickValue(googleRow, ["google_refresh_token"], [/google.*refresh.*token/i]) as string | null;
    if (!hasNonEmpty(refreshToken)) {
      return NextResponse.json({ ok: false, error: "Google token missing" }, { status: 400 });
    }

    const developerToken = String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "").trim();
    if (!developerToken) {
      return NextResponse.json({ ok: false, error: "Missing GOOGLE_ADS_DEVELOPER_TOKEN" }, { status: 500 });
    }

    const accessToken = await refreshGoogleAccessToken(String(refreshToken));

    const listRes = await fetch("https://googleads.googleapis.com/v22/customers:listAccessibleCustomers", {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
      },
    });

    if (!listRes.ok) {
      const body = await listRes.text();
      const status = listRes.status;
      const errorMessage = status === 401 || status === 403 ? "token invalid" : body.slice(0, 500);
      return NextResponse.json({ ok: false, error: errorMessage }, { status: status === 401 || status === 403 ? 401 : status });
    }

    const listJson = await listRes.json().catch(() => ({}));
    const resources: string[] = listJson?.resourceNames || listJson?.resource_names || [];
    const ids = resources
      .map((r) => String(r).split("/").pop() || "")
      .map((id) => id.trim())
      .filter(Boolean);

    const managerCustomerIdRaw = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").trim();
    const managerCustomerId = managerCustomerIdRaw ? normalizeCustomerId(managerCustomerIdRaw) : undefined;

    const accounts = await Promise.all(
      ids.map(async (id) => {
        try {
          const name = await fetchCustomerName({ accessToken, developerToken, customerId: id, managerCustomerId });
          return { id, name: name || null };
        } catch {
          return { id, name: null };
        }
      })
    );

    return NextResponse.json({ ok: true, accounts });
  } catch (e: any) {
    console.error("googleads/accounts error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
