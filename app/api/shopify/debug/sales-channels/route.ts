import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const CRON_SECRET = process.env.CRON_SECRET || process.env.CRON_TOKEN || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function assertCronAuth(req: Request) {
  const url = new URL(req.url);
  const tokenQ = url.searchParams.get("token") || "";
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const token = bearer || tokenQ;

  if (!CRON_SECRET || token !== CRON_SECRET) {
    return false;
  }
  return true;
}

async function runShopifyQL(shop: string, accessToken: string, shopifyQL: string) {
  const endpoint = `https://${shop}/admin/api/2025-10/graphql.json`;

  const gql = `
    query RunShopifyQL($query: String!) {
      shopifyqlQuery(query: $query) {
        __typename
        parseErrors
        columns {
          name
        }
        tableData {
          rowData
        }
      }
    }
  `;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: gql,
      variables: { query: shopifyQL },
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function GET(req: Request) {
  try {
    if (!assertCronAuth(req)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const client_id = url.searchParams.get("client_id");
    if (!client_id) {
      return NextResponse.json({ ok: false, error: "missing client_id" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const { data: install, error: installErr } = await supabase
      .from("shopify_app_installs")
      .select("shop_domain, access_token")
      .eq("client_id", client_id)
      .maybeSingle();

    const shop = install?.shop_domain;
    const accessToken = install?.access_token;

    if (installErr || !shop || !accessToken) {
      return NextResponse.json(
        { ok: false, error: "missing shopify install/token", details: installErr?.message },
        { status: 400 }
      );
    }

    const shopifyQL = `
FROM sales
SHOW total_sales
GROUP BY sales_channel, sales_channel_id
TIMESERIES day
SINCE startOfDay(-30d) UNTIL today
`.trim();

    const raw = await runShopifyQL(shop, accessToken, shopifyQL);

    if (!raw?.data?.shopifyqlQuery) {
      return NextResponse.json({ ok: false, error: "missing shopifyqlQuery", raw }, { status: 400 });
    }

    const node = raw?.data?.shopifyqlQuery;
    if (!node) throw new Error("No shopifyqlQuery in response");

    if (Array.isArray(node?.parseErrors) && node.parseErrors.length > 0) {
      return NextResponse.json(
        { ok: false, error: "shopifyql_parse_error", details: node.parseErrors },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, columns: node.columns, tableData: node.tableData });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
