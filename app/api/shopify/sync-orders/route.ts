import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { bucketShopifyOrderDay } from "@/lib/dates";

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function parseISODate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid date: ${day}`);
  return new Date(`${day}T00:00:00.000Z`);
}

function isoDayUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const d = parseISODate(day);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDayUTC(d);
}

function daysBetweenInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = parseISODate(start);
  const e = parseISODate(end);
  while (cur.getTime() <= e.getTime()) {
    out.push(isoDayUTC(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function shopifyGraphQL<T>(
  shop: string,
  token: string,
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2024-10";
  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  if (json?.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

type OrdersNode = {
  id: string;
  createdAt: string | null;
  processedAt: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  lineItems?: { edges?: Array<{ node?: { quantity?: number | null } | null } | null> } | null;
};

type GqlResp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: OrdersNode[];
  };
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const client_id = (url.searchParams.get("client_id") || "").trim();
    const start = (url.searchParams.get("start") || "").trim();
    const end = (url.searchParams.get("end") || "").trim();
    const fillZeros = url.searchParams.get("fillZeros") === "1";
    const shopParam = (url.searchParams.get("shop") || "").trim().toLowerCase();
    const timeZone = (url.searchParams.get("tz") || "America/Denver").trim();

    if (!client_id) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    if (!start || !end) return NextResponse.json({ ok: false, error: "Missing start/end" }, { status: 400 });

    parseISODate(start);
    parseISODate(end);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set");
    const serviceKey = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 1) Get install (token) from shopify_app_installs
    let installQuery = supabase
      .from("shopify_app_installs")
      .select("shop_domain, access_token, scopes, updated_at")
      .eq("client_id", client_id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (shopParam) {
      installQuery = supabase
        .from("shopify_app_installs")
        .select("shop_domain, access_token, scopes, updated_at")
        .eq("client_id", client_id)
        .eq("shop_domain", shopParam)
        .limit(1);
    }

    const { data: installs, error: installErr } = await installQuery;
    if (installErr) throw new Error(`Supabase install lookup failed: ${installErr.message}`);
    const install = installs?.[0];
    if (!install) {
      return NextResponse.json(
        { ok: false, error: "No Shopify install found for this client_id (and shop, if provided)" },
        { status: 404 }
      );
    }

    const shop = install.shop_domain;
    const token = install.access_token;

    // 2) Fetch orders in a slightly wider UTC window, then bucket by requested TZ day
    const queryStart = addDays(start, -2);
    const queryEnd = addDays(end, 2);

    const createdGte = `${queryStart}T00:00:00Z`;
    const createdLt = `${addDays(queryEnd, 1)}T00:00:00Z`;

    const gql = `
      query OrdersByProcessed($first: Int!, $after: String, $query: String!) {
        orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: false) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            createdAt
            processedAt
            totalPriceSet { shopMoney { amount currencyCode } }
            lineItems(first: 250) { edges { node { quantity } } }
          }
        }
      }
    `;

    const shopifyQuery = `processed_at:>=${createdGte} processed_at:<${createdLt} status:any`;

    const totalsByDay = new Map<string, { revenue: number; orders: number; units: number }>();
    const inRangeDays = new Set(daysBetweenInclusive(start, end));

    let cursor: string | null = null;
    let fetched = 0;
    let sampleLogged = false;

    while (true) {
      const data: GqlResp = await shopifyGraphQL<GqlResp>(shop, token, gql, {
        first: 250,
        after: cursor,
        query: shopifyQuery,
      });

      const nodes = data.orders.nodes || [];
      fetched += nodes.length;

      for (const o of nodes) {
        const stamp = o.processedAt || o.createdAt;
        const dayLocal = bucketShopifyOrderDay({ processedAt: o.processedAt, createdAt: o.createdAt });
        if (!stamp || !dayLocal) continue;
        if (!inRangeDays.has(dayLocal)) continue;

        if (!sampleLogged) {
          console.info("[sync-orders] sample order", {
            id: o.id,
            createdAt: o.createdAt,
            processedAt: o.processedAt,
            day: dayLocal,
          });
          sampleLogged = true;
        }

        const amtStr = o.totalPriceSet?.shopMoney?.amount ?? "0";
        const amt = Number(amtStr) || 0;

        const cur = totalsByDay.get(dayLocal) || { revenue: 0, orders: 0, units: 0 };
        cur.revenue += amt;
        cur.orders += 1;

        const items = o.lineItems?.edges ?? [];
        for (const it of items) {
          const q = Number(it?.node?.quantity ?? 0) || 0;
          cur.units += q;
        }

        totalsByDay.set(dayLocal, cur);
      }

      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
      if (!cursor) break;
    }

    // 3) Build upsert rows (optionally fill zeros)
    const days = daysBetweenInclusive(start, end);
    const rows: any[] = [];

    for (const day of days) {
      const t = totalsByDay.get(day);
      if (!t && !fillZeros) continue;

      rows.push({
        date: day,
        client_id,
        source: "shopify",
        spend: 0,
        revenue: Number(((t?.revenue ?? 0) as number).toFixed(2)),
        clicks: 0,
        impressions: 0,
        conversions: 0,
        orders: t?.orders ?? 0,
        units: t?.units ?? 0,
        conversion_value: 0,
        updated_at: new Date().toISOString(),
      });
    }

    // 4) Upsert into daily_metrics
    let written = 0;
    if (rows.length) {
      const { error: upsertErr, data: upsertData } = await supabase
        .from("daily_metrics")
        .upsert(rows, { onConflict: "client_id,source,date" })
        .select("date");

      if (upsertErr) throw new Error(`daily_metrics upsert failed: ${upsertErr.message}`);
      written = upsertData?.length ?? 0;
    }

    console.info("[sync-orders] daily_metrics upserted", { rowsWritten: written });

    return NextResponse.json({
      ok: true,
      source: "shopify",
      mode: "orders",
      shop,
      tz: timeZone,
      start,
      end,
      fetchedOrders: fetched,
      daysWritten: written,
      fillZeros,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}