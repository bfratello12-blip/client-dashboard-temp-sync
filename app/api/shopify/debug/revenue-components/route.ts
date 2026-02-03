import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadShopifyChannelExclusions } from "@/lib/shopifyExclusions";

function buildSalesChannelWhere(excludedNames: string[]) {
  if (!excludedNames.length) return "";
  const escaped = excludedNames.map((n) => `'${String(n).replace(/'/g, "\\'")}'`);
  return `WHERE sales_channel NOT IN (${escaped.join(", ")})`;
}

async function adminGraphQL(shop: string, token: string, query: string, variables?: Record<string, any>) {
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  if (json?.errors?.length) {
    const msg = json?.errors?.[0]?.message || "Unknown GraphQL error";
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  return json?.data as Record<string, any>;
}

async function runShopifyQL(shop: string, token: string, shopifyQL: string) {
  const data = await adminGraphQL(
    shop,
    token,
    `
    query ShopifyQL($query: String!) {
      shopifyqlQuery(query: $query) {
        parseErrors
        tableData {
          columns {
            name
            dataType
          }
          rows
        }
      }
    }
  `,
    { query: shopifyQL }
  );

  return data?.shopifyqlQuery as any;
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const clientId = url.searchParams.get("client_id")?.trim() || "";
    const start = url.searchParams.get("start")?.trim() || "";
    const end = url.searchParams.get("end")?.trim() || "";
    const mode = url.searchParams.get("mode")?.trim() || "shopifyql";

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json({ ok: false, error: "Missing start/end (YYYY-MM-DD)" }, { status: 400 });
    }
    if (!/\d{4}-\d{2}-\d{2}/.test(start) || !/\d{4}-\d{2}-\d{2}/.test(end)) {
      return NextResponse.json({ ok: false, error: "Invalid start/end (YYYY-MM-DD)" }, { status: 400 });
    }
    if (mode !== "shopifyql") {
      return NextResponse.json({ ok: false, error: "Invalid mode. Use shopifyql." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: install, error: installErr } = await supabase
      .from("shopify_app_installs")
      .select("shop_domain, access_token")
      .eq("client_id", clientId)
      .maybeSingle();

    const shop = install?.shop_domain || "";
    const accessToken = install?.access_token || "";

    if (installErr || !shop || !accessToken) {
      return NextResponse.json(
        { ok: false, error: "missing shopify install/token", details: installErr?.message },
        { status: 400 }
      );
    }

    const exclusions = await loadShopifyChannelExclusions(clientId);
    const excludedSalesChannelNames = exclusions.excludePos && exclusions.excludedNames.length > 0
      ? Array.from(new Set(["Point of Sale", ...exclusions.excludedNames]))
      : [];

    const whereClause = buildSalesChannelWhere(excludedSalesChannelNames);
    const shopifyQL = `FROM sales\n${whereClause ? `${whereClause}\n` : ""}SHOW net_sales, shipping_charges, taxes, total_sales\nSINCE ${start}\nUNTIL ${end}`;

    const node = await runShopifyQL(shop, accessToken, shopifyQL);
    if (!node) throw new Error("ShopifyQL response missing");

    if (Array.isArray(node?.parseErrors) && node.parseErrors.length > 0) {
      return NextResponse.json(
        { ok: false, error: "shopifyql_parse_error", details: node.parseErrors },
        { status: 400 }
      );
    }

    const table = node?.tableData;
    let rowsRaw: any = table?.rows;
    let rows: any[] = [];
    if (Array.isArray(rowsRaw)) rows = rowsRaw;
    else if (typeof rowsRaw === "string") {
      try {
        const parsed = JSON.parse(rowsRaw);
        if (Array.isArray(parsed)) rows = parsed;
      } catch {
        rows = [];
      }
    }

    return NextResponse.json({ ok: true, query: shopifyQL, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
