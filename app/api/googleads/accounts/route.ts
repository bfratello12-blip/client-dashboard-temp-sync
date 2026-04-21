// app/api/googleads/accounts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

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

type CustomerOption = {
  id: string;
  name: string | null;
  isManager?: boolean;
  parentManagerId?: string;
};

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

async function fetchManagerChildren(args: {
  accessToken: string;
  developerToken: string;
  managerCustomerId: string;
}) {
  const { accessToken, developerToken, managerCustomerId } = args;
  const managerId = normalizeCustomerId(managerCustomerId);
  if (!managerId) return [] as CustomerOption[];

  const query = `
    SELECT
      customer_client.client_customer,
      customer_client.descriptive_name,
      customer_client.manager,
      customer_client.level
    FROM customer_client
    WHERE customer_client.level <= 2
    ORDER BY customer_client.level
  `;

  const url = `https://googleads.googleapis.com/v22/customers/${encodeURIComponent(managerId)}/googleAds:search`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": managerId,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    return [] as CustomerOption[];
  }

  const json = await res.json().catch(() => ({}));
  const rows = Array.isArray(json?.results) ? json.results : [];

  const children: CustomerOption[] = [];
  for (const row of rows) {
    const cc = row?.customerClient || row?.customer_client || {};
    const resource = String(cc?.clientCustomer || cc?.client_customer || "");
    const id = normalizeCustomerId(resource.split("/").pop() || resource);
    if (!id || id === managerId) continue;

    const isManager = Boolean(cc?.manager);
    const rawName = cc?.descriptiveName ?? cc?.descriptive_name ?? null;
    const name = rawName ? String(rawName) : null;

    children.push({
      id,
      name,
      isManager,
      parentManagerId: managerId,
    });
  }

  return children;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const shopDomain = url.searchParams.get("shop_domain")?.trim() || "";
    if (!shopDomain) return NextResponse.json({ ok: false, error: "Missing shop_domain" }, { status: 400 });

    const clientId = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!clientId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

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
      return NextResponse.json({ ok: false, error: "Google not connected for this client" }, { status: 401 });
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

    const baseAccounts = await Promise.all(
      ids.map(async (id) => {
        try {
          const name = await fetchCustomerName({ accessToken, developerToken, customerId: id, managerCustomerId });
          return { id, name: name || null } as CustomerOption;
        } catch {
          return { id, name: null } as CustomerOption;
        }
      })
    );

    // Expand manager accounts into selectable child accounts.
    const childMatrix = await Promise.all(
      ids.map((id) =>
        fetchManagerChildren({
          accessToken,
          developerToken,
          managerCustomerId: id,
        })
      )
    );
    const expandedChildren = childMatrix.flat();

    const byId = new Map<string, CustomerOption>();
    for (const acct of [...baseAccounts, ...expandedChildren]) {
      if (!acct?.id) continue;
      if (!byId.has(acct.id)) {
        byId.set(acct.id, acct);
        continue;
      }
      const existing = byId.get(acct.id)!;
      // Prefer rows with a name and non-manager rows for selection clarity.
      if (!existing.name && acct.name) existing.name = acct.name;
      if (existing.isManager && acct.isManager === false) existing.isManager = false;
    }

    const accounts = Array.from(byId.values())
      .map((acct) => ({
        id: acct.id,
        name: acct.name ? `${acct.name}${acct.isManager ? " (MCC)" : ""}` : acct.id,
      }))
      .sort((a, b) => {
        const aMcc = /\(MCC\)$/i.test(a.name || "");
        const bMcc = /\(MCC\)$/i.test(b.name || "");
        if (aMcc !== bMcc) return aMcc ? 1 : -1;
        return String(a.name || a.id).localeCompare(String(b.name || b.id));
      });

    return NextResponse.json({ ok: true, accounts });
  } catch (e: any) {
    console.error("googleads/accounts error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
