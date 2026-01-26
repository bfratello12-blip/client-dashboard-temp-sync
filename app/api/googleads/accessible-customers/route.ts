// app/api/googleads/accessible-customers/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ROUTE_VERSION = "accessible-customers v8.2 + GET handler";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Support BOTH naming conventions
function getOAuthClientId(): string {
  return process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
}
function getOAuthClientSecret(): string {
  return (
    process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || ""
  );
}

function digitsOnly(id: string) {
  return (id || "").replace(/[^\d]/g, "");
}

async function safeJson(res: Response) {
  const txt = await res.text();
  try {
    return { ok: true, json: JSON.parse(txt), text: txt };
  } catch {
    return { ok: false, json: null, text: txt };
  }
}

/* -----------------------------
 * GET handler (for browser check)
 * ----------------------------- */
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "accessible-customers",
    version: ROUTE_VERSION,
    message: "Route is live. Use POST to fetch accessible Google Ads accounts.",
  });
}

/* -----------------------------
 * OAuth refresh
 * ----------------------------- */
async function refreshAccessToken() {
  const clientId = getOAuthClientId();
  const clientSecret = getOAuthClientSecret();
  const refreshToken = mustEnv("GOOGLE_ADS_REFRESH_TOKEN");

  if (!clientId)
    throw new Error("Missing GOOGLE_CLIENT_ID (or GOOGLE_ADS_CLIENT_ID)");
  if (!clientSecret)
    throw new Error("Missing GOOGLE_CLIENT_SECRET (or GOOGLE_ADS_CLIENT_SECRET)");

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const parsed = await safeJson(res);
  if (!res.ok || !parsed.ok) {
    throw new Error(
      `Token refresh failed (${res.status}): ${parsed.text?.slice(0, 500)}`
    );
  }

  const accessToken = parsed.json?.access_token as string | undefined;
  if (!accessToken) throw new Error("Token refresh did not return access_token");

  return accessToken;
}

/* -----------------------------
 * POST handler (real logic)
 * ----------------------------- */
export async function POST(req: Request) {
  try {
    const developerToken = mustEnv("GOOGLE_ADS_DEVELOPER_TOKEN");

    const body = await req.json().catch(() => ({} as any));
    const loginCustomerId = digitsOnly(
      body?.login_customer_id || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || ""
    );

    if (!loginCustomerId) {
      throw new Error(
        "Missing login_customer_id. Provide in POST body or set GOOGLE_ADS_LOGIN_CUSTOMER_ID."
      );
    }

    const accessToken: string = body?.access_token
      ? String(body.access_token)
      : await refreshAccessToken();

    /* ---- Step 1: listAccessibleCustomers ---- */
    const lacRes = await fetch(
      "https://googleads.googleapis.com/v22/customers:listAccessibleCustomers",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
        },
      }
    );
    const lacParsed = await safeJson(lacRes);

    /* ---- Step 2: MCC -> customer_client ---- */
    const gaUrl = `https://googleads.googleapis.com/v22/customers/${loginCustomerId}/googleAds:search`;

    const query = `
      SELECT
        customer_client.client_customer,
        customer_client.descriptive_name,
        customer_client.level,
        customer_client.manager,
        customer_client.status
      FROM customer_client
      WHERE customer_client.level <= 2
      ORDER BY customer_client.level
    `;

    const gaRes = await fetch(gaUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    const gaParsed = await safeJson(gaRes);

    const rows =
      gaParsed.ok && gaParsed.json?.results
        ? (gaParsed.json.results as any[])
        : [];

    const childAccounts = rows.map((r) => {
      const cc = r.customerClient || r.customer_client || {};
      const resource = String(
        cc.clientCustomer || cc.client_customer || ""
      );
      const id = digitsOnly(resource.split("/").pop() || resource);

      return {
        customer_id: id || null,
        resource_name: resource || null,
        name: cc.descriptiveName || cc.descriptive_name || null,
        level: cc.level ?? null,
        is_manager: cc.manager ?? null,
        status: cc.status ?? null,
      };
    });

    return NextResponse.json(
      {
        route_version: ROUTE_VERSION,
        mcc_login_customer_id: loginCustomerId,
        list_accessible_customers: {
          ok: lacRes.ok,
          status: lacRes.status,
        },
        google_ads_query: {
          ok: gaRes.ok,
          status: gaRes.status,
          request_url: gaUrl,
        },
        child_accounts_count: childAccounts.length,
        child_accounts: childAccounts,
        error_preview:
          !gaRes.ok ? gaParsed.text?.slice(0, 1200) ?? "" : null,
      },
      { status: gaRes.ok ? 200 : gaRes.status }
    );
  } catch (e: any) {
    console.error("accessible-customers route error:", e);
    return NextResponse.json(
      { route_version: ROUTE_VERSION, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}






