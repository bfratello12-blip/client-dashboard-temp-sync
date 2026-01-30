import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { bucketShopifyOrderDay } from "@/lib/dates";

/**
 * Shopify backfill (GraphQL, refunds-aware) — writes Shopify "Total sales" (order totals minus refunds on refund day)
 * into `daily_metrics` with source='shopify'.
 *
 * Query params:
 *   client_id (required)
 *   start=YYYY-MM-DD (required)
 *   end=YYYY-MM-DD (required)
 *   fillZeros=1 (optional)
 *   tz=America/Denver (optional)  // store timezone for daily bucketing
 */

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

type Bucket = { revenue: number; orders: number; units: number };

async function computeTotalSalesBuckets(params: {
  shop: string;
  token: string;
  start: string;
  end: string;
  timeZone: string;
}): Promise<{ buckets: Record<string, Bucket>; fetchedOrders: number; fetchedRefundScanOrders: number }> {
  const { shop, token, start, end, timeZone } = params;

  const days = new Set(daysBetweenInclusive(start, end));

  // Widen windows so timezone bucketing doesn't miss edge orders/refunds
  const qStart = addDays(start, -2);
  const qEnd = addDays(end, 2);

  // Pass 1: orders by PROCESSED_AT (order totals before returns)
  const ordersGql = `
    query OrdersProcessed($first: Int!, $after: String, $query: String!) {
      orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: false) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          createdAt
          processedAt
          cancelledAt
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 250) { edges { node { quantity } } }
        }
      }
    }
  `;

  const processedGte = `${qStart}T00:00:00Z`;
  const processedLt = `${addDays(qEnd, 1)}T00:00:00Z`;
  const ordersQuery = `processed_at:>=${processedGte} processed_at:<${processedLt}`;

  const buckets: Record<string, Bucket> = {};

  let cursor: string | null = null;
  let fetchedOrders = 0;

  let sampleLogged = false;
  while (true) {
    const data: any = await shopifyGraphQL(shop, token, ordersGql, {
      first: 250,
      after: cursor,
      query: ordersQuery,
    });

    const nodes = data?.orders?.nodes ?? [];
    fetchedOrders += nodes.length;

    for (const n of nodes) {
      if (!n?.processedAt && !n?.createdAt) continue;
      if (n?.cancelledAt) continue;

      const day = bucketShopifyOrderDay({ processedAt: n.processedAt, createdAt: n.createdAt });
      if (!day) continue;
      if (!days.has(day)) continue;

      if (!sampleLogged) {
        console.info("[shopify/backfill] sample order", {
          id: n?.id,
          createdAt: n?.createdAt || null,
          processedAt: n?.processedAt || null,
          day,
        });
        sampleLogged = true;
      }

      const amt = Number(n?.totalPriceSet?.shopMoney?.amount ?? "0") || 0;

      const b = buckets[day] || { revenue: 0, orders: 0, units: 0 };
      b.revenue += amt;
      b.orders += 1;

      const edges = n?.lineItems?.edges ?? [];
      for (const e of edges) b.units += Number(e?.node?.quantity ?? 0) || 0;

      buckets[day] = b;
    }

    if (!data?.orders?.pageInfo?.hasNextPage) break;
    cursor = data?.orders?.pageInfo?.endCursor ?? null;
    if (!cursor) break;
  }

  // Pass 2: refunds by refund.createdAt day (scan orders updated in window)
  const refundGql = `
    query OrdersUpdated($first: Int!, $after: String, $query: String!) {
      orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: false) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          refunds {
            createdAt
            totalRefundedSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  `;

  const updatedGte = `${qStart}T00:00:00Z`;
  const updatedLt = `${addDays(qEnd, 1)}T00:00:00Z`;
  const updatedQuery = `updated_at:>=${updatedGte} updated_at:<${updatedLt}`;

  cursor = null;
  let fetchedRefundScanOrders = 0;

  while (true) {
    const data: any = await shopifyGraphQL(shop, token, refundGql, {
      first: 250,
      after: cursor,
      query: updatedQuery,
    });

    const nodes = data?.orders?.nodes ?? [];
    fetchedRefundScanOrders += nodes.length;

    for (const n of nodes) {
      const refunds = n?.refunds ?? [];
      for (const r of refunds) {
        const createdAt = r?.createdAt;
        if (!createdAt) continue;

        const day = bucketShopifyOrderDay({ createdAt });
        if (!days.has(day)) continue;

        const refundAmt = Number(r?.totalRefundedSet?.shopMoney?.amount ?? "0") || 0;

        const b = buckets[day] || { revenue: 0, orders: 0, units: 0 };
        b.revenue -= refundAmt;
        buckets[day] = b;
      }
    }

    if (!data?.orders?.pageInfo?.hasNextPage) break;
    cursor = data?.orders?.pageInfo?.endCursor ?? null;
    if (!cursor) break;
  }

  // Normalize decimals
  for (const k of Object.keys(buckets)) {
    buckets[k].revenue = Number(buckets[k].revenue.toFixed(2));
  }

  return { buckets, fetchedOrders, fetchedRefundScanOrders };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const client_id = (url.searchParams.get("client_id") || "").trim();
    const start = (url.searchParams.get("start") || "").trim();
    const end = (url.searchParams.get("end") || "").trim();
    const fillZeros = url.searchParams.get("fillZeros") === "1";
    const timeZone = (url.searchParams.get("tz") || "America/Denver").trim();

    if (!client_id) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    if (!start || !end) return NextResponse.json({ ok: false, error: "Missing start/end" }, { status: 400 });
    parseISODate(start);
    parseISODate(end);

    // Auth (shared token)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const expected = process.env.SYNC_TOKEN || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
    if (expected && token !== expected) {
      return NextResponse.json({ ok: false, source: "shopify", error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set");
    const serviceKey = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Find Shopify install (token) from shopify_app_installs
    const { data: installs, error: installErr } = await sb
      .from("shopify_app_installs")
      .select("shop_domain, access_token, scopes, updated_at")
      .eq("client_id", client_id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (installErr) throw new Error(`Supabase shopify_app_installs lookup failed: ${installErr.message}`);
    const install = installs?.[0];
    if (!install) {
      return NextResponse.json({ ok: false, error: "No Shopify install found for this client_id" }, { status: 404 });
    }

    const shop = install.shop_domain;
    const accessToken = install.access_token;
    if (!shop || !accessToken) throw new Error("Shopify install missing shop_domain or access_token");

const { buckets, fetchedOrders, fetchedRefundScanOrders } = await computeTotalSalesBuckets({
      shop,
      token: accessToken,
      start,
      end,
      timeZone,
    });

    const days = daysBetweenInclusive(start, end);
    const rows: any[] = [];
    const results: any[] = [];
    let daysSkippedExisting = 0;

    const { data: existingRows, error: existingErr } = await sb
      .from("daily_metrics")
      .select("date,revenue,orders,units")
      .eq("client_id", client_id)
      .eq("source", "shopify")
      .gte("date", start)
      .lte("date", end);
    if (existingErr) {
      throw new Error(`daily_metrics lookup failed: ${existingErr.message}`);
    }
    const existingMap = new Map<string, { revenue?: number; orders?: number; units?: number }>();
    for (const r of existingRows || []) {
      const d = String((r as any).date || "");
      if (!d) continue;
      existingMap.set(d, {
        revenue: Number((r as any).revenue ?? 0),
        orders: Number((r as any).orders ?? 0),
        units: Number((r as any).units ?? 0),
      });
    }

    for (const day of days) {
      const existing = existingMap.get(day);
      if (existing && (existing.revenue || existing.orders || existing.units)) {
        daysSkippedExisting += 1;
        continue;
      }
      const b = buckets[day];
      if (!b && !fillZeros) continue;

      const revenue = Number(((b?.revenue ?? 0) as number).toFixed(2));
      const orders = b?.orders ?? 0;
      const units = b?.units ?? 0;

      rows.push({
        date: day,
        client_id,
        source: "shopify",
        spend: 0,
        revenue,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        orders,
        units,
        conversion_value: 0,
        updated_at: new Date().toISOString(),
      });

      results.push({ day, revenue, orders, units });
    }

    let daysWritten = 0;
    if (rows.length) {
      const { data: up, error: upErr } = await sb
        .from("daily_metrics")
        .upsert(rows, { onConflict: "client_id,source,date" })
        .select("date");

      if (upErr) throw new Error(`daily_metrics upsert failed: ${upErr.message}`);
      daysWritten = up?.length ?? 0;
    }

    console.info("[shopify/backfill] daily_metrics upserted", { daysWritten });
    console.info("[shopify/backfill] daily_metrics skipped existing", { daysSkippedExisting });

    return NextResponse.json({
      ok: true,
      source: "shopify",
      start,
      end,
      tz: timeZone,
      daysRequested: days.length,
      daysWritten,
      daysSkippedExisting,
      fetchedOrders,
      fetchedRefundScanOrders,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, source: "shopify", error: e?.message || String(e) }, { status: 500 });
  }
}
