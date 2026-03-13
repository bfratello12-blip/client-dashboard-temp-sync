import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyObj = Record<string, any>;

type InstallResolution = {
  clientId: string;
  shopDomain: string;
  accessToken: string;
};

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeShopDomain(shop: string) {
  const s = String(shop || "").trim().toLowerCase();
  if (!s) return "";
  const noProto = s.replace(/^https?:\/\//, "");
  const noPath = noProto.split("/")[0];
  return noPath.endsWith(".myshopify.com") ? noPath : `${noPath}.myshopify.com`;
}

function asNumber(value: any) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTrafficSource(sourceRaw: string): "organic" | "direct" | "paid" | "unknown" {
  const source = String(sourceRaw || "").trim().toLowerCase();
  if (!source) return "unknown";

  if (source.includes("direct")) return "direct";

  if (
    source.includes("paid") ||
    source.includes("cpc") ||
    source.includes("ppc") ||
    source.includes("ad") ||
    source.includes("google") ||
    source.includes("meta") ||
    source.includes("facebook") ||
    source.includes("instagram") ||
    source.includes("bing") ||
    source.includes("tiktok")
  ) {
    return "paid";
  }

  if (source.includes("organic") || source.includes("seo") || source.includes("search")) {
    return "organic";
  }

  return "unknown";
}

async function shopifyGraphQL(args: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, any>;
}) {
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
  const endpoint = `https://${args.shopDomain}/admin/api/${apiVersion}/graphql.json`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": args.accessToken,
    },
    body: JSON.stringify({
      query: args.query,
      variables: args.variables || {},
    }),
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({} as AnyObj));

  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }

  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(`Shopify GraphQL error: ${json.errors[0]?.message || "Unknown error"}`);
  }

  return json?.data as AnyObj;
}

async function resolveInstallForClient(clientId: string): Promise<InstallResolution> {
  const supabase = supabaseAdmin();

  const { data: installByClient, error: installByClientErr } = await supabase
    .from("shopify_app_installs")
    .select("client_id, shop_domain, access_token")
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();

  if (installByClientErr) {
    throw new Error(`shopify_app_installs lookup failed: ${installByClientErr.message}`);
  }

  if (installByClient?.shop_domain && installByClient?.access_token) {
    return {
      clientId: String(installByClient.client_id || clientId),
      shopDomain: normalizeShopDomain(String(installByClient.shop_domain)),
      accessToken: String(installByClient.access_token),
    };
  }

  const { data: integration, error: integrationErr } = await supabase
    .from("client_integrations")
    .select("client_id, shop_domain")
    .eq("provider", "shopify")
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();

  if (integrationErr) {
    throw new Error(`client_integrations lookup failed: ${integrationErr.message}`);
  }

  const shopDomain = normalizeShopDomain(String(integration?.shop_domain || ""));
  if (!shopDomain) {
    throw new Error(`No Shopify install found for client_id ${clientId}`);
  }

  const { data: installByShop, error: installByShopErr } = await supabase
    .from("shopify_app_installs")
    .select("client_id, shop_domain, access_token")
    .eq("shop_domain", shopDomain)
    .limit(1)
    .maybeSingle();

  if (installByShopErr) {
    throw new Error(`shopify_app_installs lookup by shop failed: ${installByShopErr.message}`);
  }

  if (!installByShop?.access_token) {
    throw new Error(`No Shopify access token found for client_id ${clientId}`);
  }

  return {
    clientId: String(installByShop.client_id || clientId),
    shopDomain: normalizeShopDomain(String(installByShop.shop_domain || shopDomain)),
    accessToken: String(installByShop.access_token),
  };
}

function parseShopifyQLRows(payload: AnyObj): Array<{ date: string; traffic_source: string; total_sales: number }> {
  const q = payload?.shopifyqlQuery;
  if (!q) return [];

  if (Array.isArray(q.parseErrors) && q.parseErrors.length > 0) {
    throw new Error(`ShopifyQL parse errors: ${q.parseErrors.join(" | ")}`);
  }

  const cols = Array.isArray(q?.tableData?.columns) ? q.tableData.columns : [];
  const colNames = cols.map((c: any) => String(c?.name || c?.displayName || "").trim().toLowerCase());

  let rowsRaw: any = q?.tableData?.rows;
  if (typeof rowsRaw === "string") {
    try {
      rowsRaw = JSON.parse(rowsRaw);
    } catch {
      rowsRaw = [];
    }
  }
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];

  const idxDate = (() => {
    const i = colNames.findIndex((n) => n === "day" || n.includes("day") || n === "date");
    return i >= 0 ? i : 0;
  })();

  const idxSource = (() => {
    const i = colNames.findIndex((n) => n === "traffic_source" || n.includes("traffic source") || n.includes("source"));
    return i >= 0 ? i : 1;
  })();

  const idxSales = (() => {
    const i = colNames.findIndex((n) => n === "total_sales" || n.includes("total sales"));
    return i >= 0 ? i : 2;
  })();

  const parsed: Array<{ date: string; traffic_source: string; total_sales: number }> = [];

  for (const row of rows) {
    if (Array.isArray(row)) {
      const date = String(row[idxDate] || "").slice(0, 10);
      if (!isIsoDate(date)) continue;
      parsed.push({
        date,
        traffic_source: String(row[idxSource] || ""),
        total_sales: asNumber(row[idxSales]),
      });
      continue;
    }

    if (row && typeof row === "object") {
      const date = String(row.day ?? row.date ?? "").slice(0, 10);
      if (!isIsoDate(date)) continue;

      const traffic_source = String(
        row.traffic_source ?? row["traffic_source"] ?? row["traffic source"] ?? row.source ?? ""
      );
      const total_sales = asNumber(row.total_sales ?? row["total_sales"] ?? row["total sales"] ?? 0);

      parsed.push({ date, traffic_source, total_sales });
    }
  }

  return parsed;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shopDomain = String(searchParams.get("shop_domain") || "").trim();
    const start = String(searchParams.get("start") || "").trim();
    const end = String(searchParams.get("end") || "").trim();

    if (!shopDomain) {
      return NextResponse.json({ success: false, error: "Missing shop_domain" }, { status: 400 });
    }

    const clientId = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!clientId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!isIsoDate(start) || !isIsoDate(end)) {
      return NextResponse.json({ success: false, error: "Invalid start/end. Use YYYY-MM-DD" }, { status: 400 });
    }

    if (start > end) {
      return NextResponse.json({ success: false, error: "start must be <= end" }, { status: 400 });
    }

    const install = await resolveInstallForClient(clientId);

    const ql = `FROM sales
SHOW total_sales
BY traffic_source
TIMESERIES day
SINCE ${start}
UNTIL ${end}
ORDER BY day ASC
LIMIT 5000`;

    const data = await shopifyGraphQL({
      shopDomain: install.shopDomain,
      accessToken: install.accessToken,
      query: `
        query ShopifyQLChannelSync($query: String!) {
          shopifyqlQuery(query: $query) {
            parseErrors
            tableData {
              columns { name dataType displayName }
              rows
            }
          }
        }
      `,
      variables: { query: ql },
    });

    const parsedRows = parseShopifyQLRows(data);

    const byKey = new Map<string, { date: string; channel: "organic" | "direct" | "paid" | "unknown"; revenue: number }>();

    for (const row of parsedRows) {
      const channel = normalizeTrafficSource(row.traffic_source);
      const date = row.date;
      const key = `${date}::${channel}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.revenue += asNumber(row.total_sales);
      } else {
        byKey.set(key, {
          date,
          channel,
          revenue: asNumber(row.total_sales),
        });
      }
    }

    const upserts = Array.from(byKey.values()).map((r) => ({
      client_id: install.clientId,
      date: r.date,
      channel: r.channel,
      revenue: r.revenue,
    }));

    if (upserts.length > 0) {
      const { error: upsertErr } = await supabaseAdmin()
        .from("daily_shopify_channel_metrics")
        .upsert(upserts, { onConflict: "client_id,date,channel" });

      if (upsertErr) {
        throw new Error(`Failed to upsert channel metrics: ${upsertErr.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      rows_synced: upserts.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
