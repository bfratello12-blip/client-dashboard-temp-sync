// app/api/shopify/sync/route.ts
// timezone-bucketing-v11
//
// Reads from:  client_integrations (provider='shopify')  [shop domain + client_id]
// Reads token from: shopify_app_installs (shop_domain + client_id)  ✅ authoritative OAuth token+scopes
// Writes to:  daily_metrics
//
// Key behavior:
// 1) Prefer ShopifyQL via Admin GraphQL `shopifyqlQuery` to match Shopify Analytics:
//    FROM sales SHOW orders, total_sales, net_items_sold TIMESERIES day ...
// 2) Fallback: aggregate orders via GraphQL orders connection.
//
// Notes:
// - daily_metrics columns are auto-detected: date col (day/date/metric_date/report_date)
//   and dimension col (source/provider/platform/channel/integration)

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { addDays, format, parseISO, differenceInCalendarDays, startOfDay, isBefore } from "date-fns";
import { bucketShopifyOrderDay } from "@/lib/dates";

type AnyObj = Record<string, any>;

function safeStr(...vals: any[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}


function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  // Returns the offset in minutes between UTC and the provided IANA timeZone at the given instant.
  // Positive means the timeZone is ahead of UTC.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const map: any = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return (asUTC - date.getTime()) / 60000;
}

function zonedDateTimeToUtcISO(dayISO: string, timeHHMMSS: string, timeZone: string): string {
  // Convert a "local" date+time in a given IANA timeZone into a UTC ISO string (ending in Z).
  // Example: ("2026-01-05", "23:59:59", "America/Denver") -> "2026-01-06T06:59:59.000Z" (winter)
  const [y, m, d] = dayISO.split("-").map((v) => Number(v));
  const [hh, mm, ss] = timeHHMMSS.split(":").map((v) => Number(v));

  // First guess at the UTC moment
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));

  // Determine the timezone offset at that instant
  const offsetMin = getTimeZoneOffsetMinutes(guess, timeZone);

  // Adjust by offset to get the actual UTC time corresponding to the local time in that timezone
  const utcMs = Date.UTC(y, m - 1, d, hh, mm, ss) - offsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

function parseStartEnd(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const s = parseISO(start);
  const e = parseISO(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  return { start: start, end: end };
}

function dateRange(startISO: string, endISO: string) {
  const out: string[] = [];
  let cur = parseISO(startISO);
  const end = parseISO(endISO);
  while (cur <= end) {
    out.push(format(cur, "yyyy-MM-dd"));
    cur = addDays(cur, 1);
  }
  return out;
}

async function adminGraphQL(shop: string, token: string, query: string, variables?: AnyObj) {
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
    const msg = safeStr(json?.errors?.[0]?.message, json?.error, json?.message) || `HTTP ${res.status}`;
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  if (json?.errors?.length) {
    const msg = safeStr(json?.errors?.[0]?.message) || "Unknown GraphQL error";
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }
  return json?.data as AnyObj;
}

async function getShopTimeZone(shop: string, token: string): Promise<string> {
  const data = await adminGraphQL(
    shop,
    token,
    `
    query ShopTZ {
      shop { ianaTimezone }
    }
  `
  );
  return safeStr(data?.shop?.ianaTimezone) || "UTC";
}

// ShopifyQL: sales TIMESERIES day
async function querySalesShopifyQL(shop: string, token: string, startISO: string, endISO: string) {
  // Match Shopify Analytics: FROM sales SHOW orders, total_sales TIMESERIES day
  const q = `FROM sales
SHOW orders, total_sales, net_items_sold
TIMESERIES day
SINCE ${startISO}
UNTIL ${endISO}
ORDER BY day ASC
LIMIT 1000`;

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
    { query: q }
  );

  const resp = data?.shopifyqlQuery;
  if (!resp) throw new Error("ShopifyQL response missing");

  if (Array.isArray((resp as any).parseErrors) && (resp as any).parseErrors.length > 0) {
    throw new Error(`ShopifyQL parse errors: ${(resp as any).parseErrors.join(" | ")}`);
  }

  const table = resp?.tableData;
  const cols: any[] = table?.columns || [];
  let rowsRaw: any = table?.rows;

  // rows is a JSON scalar; Shopify may return it as an array or a JSON string.
  let rows: any[] = [];
  if (Array.isArray(rowsRaw)) {
    rows = rowsRaw;
  } else if (typeof rowsRaw === "string") {
    try {
      const parsed = JSON.parse(rowsRaw);
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      // ignore; handled below
    }
  }

  // If rows is still empty but rowsRaw exists, keep a helpful error
  if (!Array.isArray(rows)) rows = [];
  if (rows.length === 0) {
    throw new Error("ShopifyQL returned no rows");
  }

  // Determine column indexes (fallback to [0,1,2] if we can't find them)
  const norm = (s: any) => String(s || "").trim().toLowerCase();
  const names = cols.map((c) => norm(c?.name || c?.displayName));
  const idxDay = Math.max(0, names.findIndex((n) => n === "day" || n.includes("day")));
  const idxOrders = (() => {
    const i = names.findIndex((n) => n === "orders" || n.includes("orders"));
    return i >= 0 ? i : 1;
  })();
  const idxTotalSales = (() => {
    const i = names.findIndex((n) => n === "total_sales" || n.includes("total sales") || n.includes("total_sales"));
    return i >= 0 ? i : 2;
  })();
const idxNetItems = (() => {
  // ShopifyQL commonly returns "net_items_sold" for unit counts
  const i = names.findIndex(
    (n) =>
      n === "net_items_sold" ||
      n.includes("net_items_sold") ||
      n.includes("net items sold") ||
      n.includes("net items") ||
      n === "units" ||
      n.includes("units")
  );
  return i; // keep -1 if not found
})();


  const bucketsRevenue: Record<string, number> = {};
  const bucketsOrders: Record<string, number> = {};
  const bucketsUnits: Record<string, number> = {};

  for (const row of rows) {
    // Shopify may return each row as either:
    // - an array aligned to columns, OR
    // - an object keyed by column name (seen in practice)
    let day = "";
    let orders = 0;
    let totalSales = 0;
    let units = 0;

    if (Array.isArray(row)) {
      day = safeStr(row?.[idxDay]) || "";
      orders = Number(row?.[idxOrders] ?? 0) || 0;
      totalSales = Number(row?.[idxTotalSales] ?? 0) || 0;
      units = idxNetItems >= 0 ? (Number(row?.[idxNetItems] ?? 0) || 0) : 0;
    } else if (row && typeof row === "object") {
      // Prefer direct keys first
      const r: any = row;
      day = safeStr(r.day ?? r.Day ?? r.date ?? r.Date) || "";
      orders = Number(r.orders ?? r.Orders ?? r.order_count ?? r["order count"] ?? 0) || 0;
      totalSales =
        Number(
          r.total_sales ??
            r["total_sales"] ??
            r["total sales"] ??
            r.totalSales ??
            r["Total sales"] ??
            0
        ) || 0;

      units =
        idxNetItems >= 0
          ? Number(
              r.net_items_sold ??
                r["net_items_sold"] ??
                r["net items sold"] ??
                r.units ??
                r.Units ??
                0
            ) || 0
          : 0;

      // If day is still missing, try using column names as keys
      if (!day && idxDay >= 0 && cols[idxDay]?.name) {
        day = safeStr(r[cols[idxDay].name]) || "";
      }
      if (!orders && idxOrders >= 0 && cols[idxOrders]?.name) {
        orders = Number(r[cols[idxOrders].name] ?? 0) || 0;
      }
      if (!totalSales && idxTotalSales >= 0 && cols[idxTotalSales]?.name) {
        totalSales = Number(r[cols[idxTotalSales].name] ?? 0) || 0;
      }
      if (!units && idxNetItems >= 0 && cols[idxNetItems]?.name) {
        units = Number(r[cols[idxNetItems].name] ?? 0) || 0;
      }
    } else {
      continue;
    }

    if (!day) continue;

    bucketsOrders[day] = orders;
    bucketsRevenue[day] = totalSales;
    bucketsUnits[day] = units;
  }

  return { bucketsRevenue, bucketsOrders, bucketsUnits, rowsCount: rows.length };
}


// Fallback: aggregate orders by createdAt, using shop timezone day-bucketing
async function queryOrdersFallback(shop: string, token: string, startISO: string, endISO: string, timeZone: string) {
  // Orders-based approximation of Shopify "Total sales over time":
  // - Bucket orders by order.createdAt day in shop timezone
  // - Bucket refunds/returns by refund.createdAt day in shop timezone
  // - revenue(day) = sum(order totalPriceSet) - sum(refund totalRefundedSet) for that day
  //
  // This matches Shopify's report much closer than summing order totals alone.
  const bucketsRevenue: Record<string, number> = {};
  const bucketsOrders: Record<string, number> = {};
  const bucketsRefunds: Record<string, number> = {};
  const bucketsUnits: Record<string, number> = {};

  // Build an explicit UTC timestamp window that corresponds to [startISO 00:00:00 .. endISO 23:59:59] in shop TZ.
  const startUtc = zonedDateTimeToUtcISO(startISO, "00:00:00", timeZone);
  const endUtc = zonedDateTimeToUtcISO(endISO, "23:59:59", timeZone);

  const pageSize = 200;

  // -------- Pass 1: Orders created in window (revenue + order count) --------
  {
    let after: string | null = null;
    let sampleLogged = false;
    while (true) {
      const data = await adminGraphQL(
        shop,
        token,
        `
        query OrdersProcessed($first: Int!, $after: String, $query: String!) {
          orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                processedAt
                createdAt
                cancelledAt
                totalPriceSet { shopMoney { amount } }
                lineItems(first: 250) { edges { node { quantity } } }
              }
            }
          }
        }
      `,
        {
          first: pageSize,
          after,
          query: `processed_at:>=${startUtc} processed_at:<=${endUtc} status:any`,
        }
      );

      const conn = data?.orders;
      const edges = conn?.edges || [];
      for (const e of edges) {
        const n = e?.node;
        if (!n?.processedAt && !n?.createdAt) continue;
        if (n?.cancelledAt) continue; // ignore cancelled orders
        const stamp = n.processedAt || n.createdAt;
        if (!stamp) continue;
        const day = bucketShopifyOrderDay({ processedAt: n.processedAt, createdAt: n.createdAt });
        if (!day) continue;
        if (!sampleLogged) {
          console.info("[shopify/sync] sample order", {
            id: n?.id,
            createdAt: n?.createdAt || null,
            processedAt: n?.processedAt || null,
            day,
          });
          sampleLogged = true;
        }
        const amt = Number(n?.totalPriceSet?.shopMoney?.amount ?? 0) || 0;
        bucketsRevenue[day] = (bucketsRevenue[day] || 0) + amt;
        bucketsOrders[day] = (bucketsOrders[day] || 0) + 1;
        const items = n?.lineItems?.edges ?? [];
        let qty = 0;
        for (const it of items) qty += Number(it?.node?.quantity ?? 0) || 0;
        bucketsUnits[day] = (bucketsUnits[day] || 0) + qty;
      }

      if (!conn?.pageInfo?.hasNextPage) break;
      after = conn?.pageInfo?.endCursor;
      if (!after) break;
    }
  }

  // -------- Pass 2: Refunds created in window (subtract on refund day) ------
  // Shopify's "returns" in the sales report are attributed to when the refund occurs,
  // not when the original order was created. We approximate this by querying orders
  // updated in the window and extracting refunds whose createdAt is in the window.
  {
    let after: string | null = null;
    const startMs = Date.parse(startUtc);
    const endMs = Date.parse(endUtc);

    while (true) {
      const data = await adminGraphQL(
        shop,
        token,
        `
        query OrdersUpdated($first: Int!, $after: String, $query: String!) {
          orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                updatedAt
                refunds {
                  createdAt
                  totalRefundedSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      `,
        {
          first: pageSize,
          after,
          query: `updated_at:>=${startUtc} updated_at:<=${endUtc} status:any`,
        }
      );

      const conn = data?.orders;
      const edges = conn?.edges || [];
      for (const e of edges) {
        const n = e?.node;
        const refundsList = n?.refunds || [];
        for (const ref of refundsList) {
          if (!ref?.createdAt) continue;
          const ms = Date.parse(ref.createdAt);
          if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
            if (ms < startMs || ms > endMs) continue;
          }
          const day = bucketShopifyOrderDay({ createdAt: ref.createdAt });
          const amt = Number(ref?.totalRefundedSet?.shopMoney?.amount ?? 0) || 0;
          if (amt <= 0) continue;
          bucketsRefunds[day] = (bucketsRefunds[day] || 0) + amt;
        }
      }

      if (!conn?.pageInfo?.hasNextPage) break;
      after = conn?.pageInfo?.endCursor;
      if (!after) break;
    }
  }

  // Apply refunds to revenue bucket for matching days
  for (const [day, refundAmt] of Object.entries(bucketsRefunds)) {
    bucketsRevenue[day] = (bucketsRevenue[day] || 0) - (Number(refundAmt) || 0);
  }

  return { bucketsRevenue, bucketsOrders, bucketsUnits };
}

async function queryDailyCogsCoverage(
  shop: string,
  token: string,
  startISO: string,
  endISO: string,
  timeZone: string
) {
  let scannedLineItems = 0;
  let withVariant = 0;
  let withInventoryItem = 0;
  let withUnitCost = 0;
  let loggedNoUnitCost = 0;

  const productCogsKnownByDay: Record<string, number> = {};
  const revenueWithCogsByDay: Record<string, number> = {};
  const unitsWithCogsByDay: Record<string, number> = {};

  const startUtc = zonedDateTimeToUtcISO(startISO, "00:00:00", timeZone);
  const endUtc = zonedDateTimeToUtcISO(endISO, "23:59:59", timeZone);

  const pageSize = 100;
  let after: string | null = null;
  let sampleLogged = false;

  while (true) {
    const data = await adminGraphQL(
      shop,
      token,
      `
      query OrdersCogs($first: Int!, $after: String, $query: String!) {
        orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              processedAt
              createdAt
              cancelledAt
              lineItems(first: 250) {
                edges {
                  node {
                    quantity
                    discountedTotalSet(withCodeDiscounts: true) { shopMoney { amount } }
                    originalTotalSet { shopMoney { amount } }
                    variant { id inventoryItem { unitCost { amount } } }
                  }
                }
              }
            }
          }
        }
      }
    `,
      {
        first: pageSize,
        after,
        query: `processed_at:>=${startUtc} processed_at:<=${endUtc} status:any`,
      }
    );

    const conn = data?.orders;
    const edges = conn?.edges || [];
    for (const e of edges) {
      const n = e?.node;
      if (!n) continue;
      if (n?.cancelledAt) continue;
      const stamp = n.processedAt || n.createdAt;
      if (!stamp) continue;
      const day = bucketShopifyOrderDay({ processedAt: n.processedAt, createdAt: n.createdAt });
      if (!day) continue;
      if (!sampleLogged) {
        console.info("[shopify/sync] sample cogs order", {
          id: n?.id,
          createdAt: n?.createdAt || null,
          processedAt: n?.processedAt || null,
          day,
        });
        sampleLogged = true;
      }
      const items = n?.lineItems?.edges ?? [];
      for (const it of items) {
        const li = it?.node;
        if (!li) continue;
        scannedLineItems += 1;

        const hasVariant = Boolean(li?.variant);
        if (hasVariant) withVariant += 1;

        const hasInventoryItem = Boolean(li?.variant?.inventoryItem);
        if (hasInventoryItem) withInventoryItem += 1;

        const unitCostAmountRaw = li?.variant?.inventoryItem?.unitCost?.amount;
        if (unitCostAmountRaw != null) withUnitCost += 1;

        if (hasInventoryItem && unitCostAmountRaw == null && loggedNoUnitCost < 3) {
          console.log("[COGS DEBUG] inventoryItem without unitCost", li?.variant?.id);
          loggedNoUnitCost += 1;
        }

        const qty = Number(li?.quantity ?? 0) || 0;
        if (qty <= 0) continue;
        const unitCost = Number(unitCostAmountRaw ?? 0) || 0;
        if (unitCost <= 0) continue;

        const lineRevenue =
          Number(li?.discountedTotalSet?.shopMoney?.amount ?? li?.originalTotalSet?.shopMoney?.amount ?? 0) || 0;

        productCogsKnownByDay[day] = (productCogsKnownByDay[day] || 0) + unitCost * qty;
        unitsWithCogsByDay[day] = (unitsWithCogsByDay[day] || 0) + qty;
        revenueWithCogsByDay[day] = (revenueWithCogsByDay[day] || 0) + lineRevenue;
      }
    }

    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn?.pageInfo?.endCursor;
    if (!after) break;
  }

  console.log("[COGS DEBUG]", {
    scannedLineItems,
    withVariant,
    withInventoryItem,
    withUnitCost,
  });

  return { productCogsKnownByDay, revenueWithCogsByDay, unitsWithCogsByDay };
}


// --- Shopify install token lookup (auto-detect shop column) ------------------

async function detectColumn(
  supabase: any,
  table: string,
  candidates: string[]
): Promise<string | null> {
  for (const col of candidates) {
    const { error } = await supabase.from(table).select(col).limit(1);
    if (!error) return col;
  }
  return null;
}

function normalizeShop(shop: string): string {
  const s = (shop || "").trim().toLowerCase();
  const noProto = s.replace(/^https?:\/\//, "");
  const noPath = noProto.split("/")[0];
  return noPath;
}

async function getInstallTokenForShop(
  supabase: any,
  clientId: string,
  shop: string
): Promise<string | null> {
  const table = "shopify_app_installs";
  const shopNorm = normalizeShop(shop);

  const shopCol = await detectColumn(supabase, table, [
    "shop_domain",
    "shop",
    "myshopify_domain",
    "domain",
    "store_domain",
    "store",
  ]);

  const tokenCol = await detectColumn(supabase, table, [
    "access_token",
    "token",
    "token_ref",
  ]);

  // some schemas don't have created_at; pick the best available timestamp column (or none)
  const tsCol = await detectColumn(supabase, table, [
    "updated_at",
    "created_at",
    "installed_at",
    "createdAt",
    "updatedAt",
  ]);

  if (!shopCol || !tokenCol) {
    throw new Error(
      `shopify_app_installs missing expected columns. Found shopCol=${shopCol}, tokenCol=${tokenCol}`
    );
  }

  const selectCols = `${tokenCol}, ${shopCol}, client_id`;

  // 1) client_id + normalized shop
  {
    let q = supabase
      .from(table)
      .select(selectCols)
      .eq("client_id", clientId)
      .eq(shopCol, shopNorm)
      .limit(1);

    if (tsCol) q = q.order(tsCol, { ascending: false });

    const { data, error } = await q;
    if (error) throw new Error(`shopify_app_installs lookup failed: ${error.message}`);

    const row = data?.[0] as any;
    const tok = row?.[tokenCol];
    if (typeof tok === "string" && tok.length > 0) return tok;
  }

  // 2) client_id + raw shop (in case stored differently)
  {
    let q = supabase
      .from(table)
      .select(selectCols)
      .eq("client_id", clientId)
      .eq(shopCol, shop)
      .limit(1);

    if (tsCol) q = q.order(tsCol, { ascending: false });

    const { data, error } = await q;
    if (error) throw new Error(`shopify_app_installs lookup failed: ${error.message}`);

    const row = data?.[0] as any;
    const tok = row?.[tokenCol];
    if (typeof tok === "string" && tok.length > 0) return tok;
  }

  // 3) fallback: shop-only (handles installs where client_id wasn't stored)
  {
    let q = supabase
      .from(table)
      .select(selectCols)
      .eq(shopCol, shopNorm)
      .limit(1);

    if (tsCol) q = q.order(tsCol, { ascending: false });

    const { data, error } = await q;
    if (error) throw new Error(`shopify_app_installs lookup failed: ${error.message}`);

    const row = data?.[0] as any;
    const tok = row?.[tokenCol];
    if (typeof tok === "string" && tok.length > 0) return tok;
  }

  return null;
}


async function getIntegrationTokenForShop(
  supabase: any,
  clientId: string,
  shopDomain: string
): Promise<string | null> {
  // client_integrations.token_ref is used as a fallback Shopify access token for legacy installs.
  // Some environments may not have this column; in that case we just return null.
  try {
    const { data, error } = await supabase
      .from("client_integrations")
      .select("token_ref")
      .eq("provider", "shopify")
      .eq("client_id", clientId)
      .eq("shop_domain", shopDomain)
      .maybeSingle();

    if (error) return null;
    const token = (data as any)?.token_ref;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

async function validateShopifyToken(shopDomain: string, token: string): Promise<void> {
  // Minimal query to verify the token works for this shop.
  await adminGraphQL(
    shopDomain,
    token,
    `{ shop { name myshopifyDomain } }`,
    {}
  );
}

async function pickWorkingShopifyToken(
  shopDomain: string,
  tokens: Array<string | null | undefined>
): Promise<string> {
  const tried: string[] = [];
  for (const t of tokens) {
    const token = typeof t === "string" ? t.trim() : "";
    if (!token) continue;
    if (tried.includes(token)) continue;
    tried.push(token);

    try {
      await validateShopifyToken(shopDomain, token);
      return token;
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      // Only fall through to the next token on auth-type failures.
      if (msg.includes("HTTP 401") || msg.toLowerCase().includes("access token") || msg.toLowerCase().includes("unauthorized")) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("No valid Shopify access token found for this shop (401).");
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const fillZeros = searchParams.get("fillZeros") === "1";
    const debugScopes = searchParams.get("debugScopes") === "1";
    const onlyClientId = (searchParams.get("client_id") || "").trim() || null;

    // Sync mode:
    // - shopifyql: force ShopifyQL (matches Shopify Analytics best); throw on failure
    // - orders: force orders-aggregation fallback
    // - auto: try ShopifyQL, fall back to orders if ShopifyQL fails
    const modeParam = (searchParams.get("mode") || process.env.SHOPIFY_SYNC_MODE || "shopifyql")
      .trim()
      .toLowerCase();

    if (!["shopifyql", "orders", "auto"].includes(modeParam)) {
      return NextResponse.json(
        { ok: false, error: `Invalid mode=${modeParam}. Use shopifyql|orders|auto.` },
        { status: 400 }
      );
    }

    const window = parseStartEnd(start, end);
    if (!window) {
      return NextResponse.json(
        { ok: false, error: "Missing/invalid start/end (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    let startDay = window.start;
    const endDay = window.end;

    // Shopify order/refund endpoints often become unreliable beyond ~60 days.
    // For windows older than that, preserve any historical backfill already in the DB.
    const maxDaysBack = Number(process.env.SHOPIFY_MAX_DAYS_BACK || "60");
    const cutoffDay = format(addDays(startOfDay(new Date()), -maxDaysBack), "yyyy-MM-dd");

    const force = searchParams.get("force") === "1";

    const dateColCandidates = ["day", "date", "metric_date", "report_date"];
    let dateColForCount: string | null = null;
    for (const c of dateColCandidates) {
      const { error } = await supabase.from("daily_metrics").select(c).limit(1);
      if (!error) {
        dateColForCount = c;
        break;
      }
    }
    if (!dateColForCount) dateColForCount = "date";

    const shopParamRaw = searchParams.get("shop")?.trim() || "";
    const shopParam = shopParamRaw ? normalizeShop(shopParamRaw) : "";

    let existingCount = 0;
    const daysAgoEnd = differenceInCalendarDays(startOfDay(new Date()), parseISO(endDay));
    const isOlderThan60Days = daysAgoEnd > maxDaysBack;

    if (isOlderThan60Days && !force) {
      let clientIdForCount = onlyClientId;
      if (!clientIdForCount && shopParam) {
        const { data: install, error: installErr } = await supabase
          .from("shopify_app_installs")
          .select("client_id")
          .eq("shop_domain", shopParam)
          .maybeSingle();
        if (installErr) throw new Error(`shopify_app_installs lookup failed: ${installErr.message}`);
        clientIdForCount = install?.client_id ? String(install.client_id) : null;
      }

      if (clientIdForCount) {
        const { count, error: countErr } = await supabase
          .from("daily_metrics")
          .select(dateColForCount, { count: "exact", head: true })
          .eq("client_id", clientIdForCount)
          .eq("source", "shopify")
          .gte(dateColForCount, startDay)
          .lte(dateColForCount, endDay);
        if (countErr) throw new Error(`daily_metrics count failed: ${countErr.message}`);
        existingCount = count ?? 0;
      }

      const skipped = existingCount > 0;
      console.info("[shopify/sync] skip_check", {
        endDate: endDay,
        isOlderThan60Days,
        existingCount,
        skipped,
        force,
      });

      if (skipped) {
        return NextResponse.json({
          ok: true,
          source: "shopify",
          start: window.start,
          end: window.end,
          fillZeros,
          skipped: true,
          reason: `Requested window end is older than ${maxDaysBack} days. Skipping sync to avoid overwriting backfilled history.`,
        });
      }
    } else {
      console.info("[shopify/sync] skip_check", {
        endDate: endDay,
        isOlderThan60Days,
        existingCount,
        skipped: false,
        force,
      });
    }

    // If the requested start is older than our cutoff, clamp the query window.
    // This prevents fillZeros from overwriting manually-backfilled historical days with zeros.
    if (!force && isBefore(parseISO(startDay), parseISO(cutoffDay))) {
      console.log(`[shopify/sync] Clamping startDay ${startDay} -> ${cutoffDay} (maxDaysBack=${maxDaysBack})`);
      startDay = cutoffDay;
    }

const days = dateRange(startDay, endDay);

    // Determine which daily_metrics columns exist (date + source/provider)
    const sourceColCandidates = ["source", "provider", "platform", "channel", "integration"];

    let dateCol: string | null = null;
    for (const c of dateColCandidates) {
      const { error } = await supabase.from("daily_metrics").select(c).limit(1);
      if (!error) {
        dateCol = c;
        break;
      }
    }
    if (!dateCol) dateCol = "day";

    let sourceCol: string | null = null;
    for (const c of sourceColCandidates) {
      const { error } = await supabase.from("daily_metrics").select(c).limit(1);
      if (!error) {
        sourceCol = c;
        break;
      }
    }
    if (!sourceCol) sourceCol = "source";

    // Optional columns
    // Optional columns
    const hasRevenue = !(await supabase.from("daily_metrics").select("revenue").limit(1)).error;
    const hasOrders  = !(await supabase.from("daily_metrics").select("orders").limit(1)).error;
    const hasUnits   = !(await supabase.from("daily_metrics").select("units").limit(1)).error;



    const shopParamRaw = searchParams.get("shop")?.trim() || "";
    const shopParam = shopParamRaw ? normalizeShop(shopParamRaw) : "";

    if (!shopParam && !onlyClientId) {
      return NextResponse.json(
        { ok: false, error: "Missing shop or client_id" },
        { status: 400 }
      );
    }

    const resolvedIntegrations: Array<{ client_id: string; shop_domain: string; resolution_source: string }> = [];

    if (shopParam) {
      const { data: install, error: installErr } = await supabase
        .from("shopify_app_installs")
        .select("client_id, shop_domain, access_token")
        .eq("shop_domain", shopParam)
        .maybeSingle();
      if (installErr) throw new Error(`shopify_app_installs lookup failed: ${installErr.message}`);

      if (install?.client_id && install?.shop_domain) {
        if (onlyClientId && String(install.client_id) !== onlyClientId) {
          return NextResponse.json(
            { ok: false, error: "client_id does not match shopify_app_installs for shop" },
            { status: 400 }
          );
        }
        resolvedIntegrations.push({
          client_id: String(install.client_id),
          shop_domain: String(install.shop_domain),
          resolution_source: "query:shop",
        });
      } else {
        const { data: integ, error: integErr } = await supabase
          .from("client_integrations")
          .select("client_id, shop_domain")
          .eq("provider", "shopify")
          .eq("shop_domain", shopParam)
          .maybeSingle();
        if (integErr) throw new Error(`client_integrations query failed: ${integErr.message}`);

        if (!integ?.client_id || !integ?.shop_domain) {
          return NextResponse.json(
            { ok: false, error: `No shopify_app_installs row found for shop ${shopParam}` },
            { status: 400 }
          );
        }
        if (onlyClientId && String(integ.client_id) !== onlyClientId) {
          return NextResponse.json(
            { ok: false, error: "client_id does not match client_integrations for shop" },
            { status: 400 }
          );
        }
        resolvedIntegrations.push({
          client_id: String(integ.client_id),
          shop_domain: String(integ.shop_domain),
          resolution_source: "client_integrations:fallback",
        });
      }
    } else if (onlyClientId) {
      const { data: install, error: installErr } = await supabase
        .from("shopify_app_installs")
        .select("client_id, shop_domain, access_token")
        .eq("client_id", onlyClientId)
        .maybeSingle();
      if (installErr) throw new Error(`shopify_app_installs lookup failed: ${installErr.message}`);

      if (install?.client_id && install?.shop_domain) {
        resolvedIntegrations.push({
          client_id: String(install.client_id),
          shop_domain: String(install.shop_domain),
          resolution_source: "install:client_id",
        });
      } else {
        const { data: integ, error: integErr } = await supabase
          .from("client_integrations")
          .select("client_id, shop_domain")
          .eq("provider", "shopify")
          .eq("client_id", onlyClientId)
          .maybeSingle();
        if (integErr) throw new Error(`client_integrations query failed: ${integErr.message}`);

        if (!integ?.client_id || !integ?.shop_domain) {
          return NextResponse.json(
            { ok: false, error: `No shopify_app_installs row found for client_id ${onlyClientId}` },
            { status: 400 }
          );
        }
        resolvedIntegrations.push({
          client_id: String(integ.client_id),
          shop_domain: String(integ.shop_domain),
          resolution_source: "client_integrations:fallback",
        });
      }
    }

    for (const r of resolvedIntegrations) {
      console.info("[shopify/sync] resolved", {
        shop_domain: r.shop_domain,
        client_id: r.client_id,
        source: r.resolution_source,
      });
    }

    const errors: any[] = [];
    const results: any[] = [];
    let daysWritten = 0;
    let zerosInserted = 0;
    let daysWrittenShopifyQL = 0;
    let daysWrittenFallback = 0;

    for (const integ of resolvedIntegrations || []) {
      const clientId = integ.client_id;
      const shop = safeStr(integ.shop_domain) || "";

      if (!clientId || !shop) {
        errors.push({ client_id: clientId, error: "Missing client_id or shop domain in client_integrations row." });
        continue;
      }

      let integrationStatus: "ok" | "error" = "ok";
      let integrationError: string | null = null;
      let coverageAttempted = false;
      let coverageRowsUpserted = 0;
      let dailyTotalsSucceeded = false;

      try {
        // Token from shopify_app_installs (authoritative OAuth install)
        // Try token from shopify_app_installs first; fall back to client_integrations.token_ref (legacy/custom installs).
        const installToken = await getInstallTokenForShop(supabase, clientId, shop);
        const integrationToken = await getIntegrationTokenForShop(supabase, clientId, shop);
        const token = await pickWorkingShopifyToken(normalizeShop(shop), [installToken, integrationToken]);

        if (debugScopes) {
          try {
            const scopesRes = await fetch(
              `https://${normalizeShop(shop)}/admin/oauth/access_scopes.json`,
              {
                method: "GET",
                headers: {
                  "X-Shopify-Access-Token": token,
                },
              }
            );
            const scopesJson = await scopesRes.json().catch(() => null);
            if (!scopesRes.ok) {
              throw new Error(`HTTP ${scopesRes.status}`);
            }
            const handles = Array.isArray(scopesJson?.access_scopes)
              ? scopesJson.access_scopes.map((s: any) => String(s?.handle || "").trim()).filter(Boolean)
              : [];
            console.log(`[shopify/sync] granted scopes: ${handles.join(",")}`);
          } catch (e: any) {
            console.warn("[shopify/sync] scope check failed:", e?.message || String(e));
          }
        }

        // Shop timezone (still used for fallback)
        let tz = "UTC";
        try {
          tz = await getShopTimeZone(normalizeShop(shop), token);
        } catch {
          // ignore
        }

        let bucketsRevenue: Record<string, number> = {};
        let bucketsOrders: Record<string, number> = {};
        let bucketsUnits: Record<string, number> = {};
        let revenueSource: "shopifyql" | "fallback" = "shopifyql";

        const normalizedShop = normalizeShop(shop);

        if (modeParam === "orders") {
          const fallback = await queryOrdersFallback(normalizedShop, token, startDay, endDay, tz);
          bucketsRevenue = fallback.bucketsRevenue;
          bucketsOrders = fallback.bucketsOrders;
          bucketsUnits = fallback.bucketsUnits || {};
          revenueSource = "fallback";
        } else if (modeParam === "shopifyql") {
          try {
            const ql = await querySalesShopifyQL(normalizedShop, token, startDay, endDay);
            bucketsRevenue = ql.bucketsRevenue;
            bucketsOrders = ql.bucketsOrders;
            bucketsUnits = ql.bucketsUnits || {};
            revenueSource = "shopifyql";
          } catch (e: any) {
            const fallback = await queryOrdersFallback(normalizedShop, token, startDay, endDay, tz);
            bucketsRevenue = fallback.bucketsRevenue;
            bucketsOrders = fallback.bucketsOrders;
            bucketsUnits = fallback.bucketsUnits || {};
            revenueSource = "fallback";
          }
        } else {
          // auto
          try {
            const ql = await querySalesShopifyQL(normalizedShop, token, startDay, endDay);
            bucketsRevenue = ql.bucketsRevenue;
            bucketsOrders = ql.bucketsOrders;
            bucketsUnits = ql.bucketsUnits || {};
            revenueSource = "shopifyql";
          } catch (e: any) {
            const fallback = await queryOrdersFallback(normalizedShop, token, startDay, endDay, tz);
            bucketsRevenue = fallback.bucketsRevenue;
            bucketsOrders = fallback.bucketsOrders;
            bucketsUnits = fallback.bucketsUnits || {};
            revenueSource = "fallback";
          }
        }

        
      // Pull existing Shopify rows for this window so we don't overwrite historical backfill with zeros.
      const existingMap = new Map<string, { revenue?: number; orders?: number; units?: number }>();
      {
        const selectCols = [dateCol];
        if (hasRevenue) selectCols.push("revenue");
        if (hasOrders) selectCols.push("orders");
        if (hasUnits) selectCols.push("units");
        const { data: existingRows, error: existingErr } = await supabase
          .from("daily_metrics")
          .select(selectCols.join(","))
          .eq("client_id", clientId)
          .eq("source", "shopify")
          .gte(dateCol, startDay)
          .lte(dateCol, endDay);
        if (existingErr) {
          console.warn("[shopify/sync] Could not fetch existing rows; proceeding without overwrite-protection:", existingErr.message);
        } else {
          for (const r of existingRows || []) {
            const d = String((r as any)[dateCol]);
            existingMap.set(d, {
              revenue: hasRevenue ? Number((r as any).revenue ?? 0) : undefined,
              orders: hasOrders ? Number((r as any).orders ?? 0) : undefined,
              units: hasUnits ? Number((r as any).units ?? 0) : undefined,
            });
          }
        }
      }

const rows = days.map((day) => {
          const revenue = Number(bucketsRevenue[day] ?? 0) || 0;
          const orders = Number(bucketsOrders[day] ?? 0) || 0;
          const units = Number(bucketsUnits[day] ?? 0) || 0;

          if (revenue === 0 && orders === 0 && units === 0) {
            const existing = existingMap.get(day);
            const exRev = Number(existing?.revenue ?? 0);
            const exOrd = Number(existing?.orders ?? 0);
            const exUnits = Number(existing?.units ?? 0);
            if (exRev !== 0 || exOrd !== 0 || exUnits !== 0) {
              // Preserve historical/backfilled data.
              return null;
            }
          }



          return {
            client_id: clientId,
            [dateCol as string]: day,
            [sourceCol as string]: "shopify",
            revenue,
            orders,
            ...(hasUnits ? { units: Number(bucketsUnits[day] ?? 0) || 0 } : {}),
          };
        }).filter(Boolean) as any[];

        // Upsert rows
        const { error: upErr } = await supabase.from("daily_metrics").upsert(rows, {
          onConflict: `client_id,${dateCol},${sourceCol}`,
        });

        if (upErr) throw new Error(`daily_metrics upsert failed: ${upErr.message}`);
        dailyTotalsSucceeded = true;
        console.info("[shopify/sync] daily_metrics upserted", {
          client_id: clientId,
          rows: rows.length,
        });
        if (revenueSource === "shopifyql") {
          daysWrittenShopifyQL += rows.length;
          console.info("[shopify/sync] shopifyql days written", {
            client_id: clientId,
            days: rows.length,
          });
        } else {
          daysWrittenFallback += rows.length;
          console.info("[shopify/sync] fallback days written", {
            client_id: clientId,
            days: rows.length,
          });
        }

        try {
          coverageAttempted = true;
          const coverage = await queryDailyCogsCoverage(
            normalizedShop,
            token,
            startDay,
            endDay,
            tz
          );

          const coverageRows = days
            .map((day) => {
              const product_cogs_known = Number(coverage.productCogsKnownByDay[day] ?? 0) || 0;
              const revenue_with_cogs = Number(coverage.revenueWithCogsByDay[day] ?? 0) || 0;
              const units_with_cogs = Number(coverage.unitsWithCogsByDay[day] ?? 0) || 0;

              if (product_cogs_known <= 0 && revenue_with_cogs <= 0 && units_with_cogs <= 0) return null;

              return {
                client_id: clientId,
                date: day,
                product_cogs_known,
                revenue_with_cogs,
                units_with_cogs,
              };
            })
            .filter(Boolean) as any[];

          if (coverageRows.length) {
            coverageRowsUpserted = coverageRows.length;
            const { error: cErr } = await supabase
              .from("daily_shopify_cogs_coverage")
              .upsert(coverageRows, { onConflict: "client_id,date" });
            if (cErr) throw cErr;
            console.info("[shopify/sync] daily_shopify_cogs_coverage upserted", {
              client_id: clientId,
              rows: coverageRowsUpserted,
            });
          }
        } catch (e: any) {
          integrationStatus = "error";
          integrationError = `unit-cost coverage: ${e?.message || String(e)}`;
          console.warn(
            "[shopify/sync] unit-cost coverage compute/upsert failed:",
            e?.message || String(e)
          );
        }

        daysWritten += rows.length;
        results.push({ client_id: clientId, status: "ok", daysReturned: rows.length });
      } catch (e: any) {
        integrationStatus = "error";
        integrationError = e?.message || String(e);
        errors.push({ client_id: clientId, error: e?.message || String(e) });

        if (fillZeros) {
          // still write zeros for this client to preserve no-gaps invariant
          const rows = days.map((day) => ({
            client_id: clientId,
            [dateCol as string]: day,
            [sourceCol as string]: "shopify",
            ...(hasRevenue ? { revenue: 0 } : {}),
            ...(hasOrders ? { orders: 0 } : {}),
            ...(hasUnits ? { units: 0 } : {}),
          }));

          const { error: upErr } = await supabase.from("daily_metrics").upsert(rows, {
            onConflict: `client_id,${dateCol},${sourceCol}`,
            // IMPORTANT: For zero-fill rows, never overwrite an existing row.
            // This prevents wiping out manual backfills when someone syncs an older window.
            ignoreDuplicates: true,
          });

          if (!upErr) {
            zerosInserted += rows.length;
          }}
      } finally {
        const nowISO = new Date().toISOString();
        try {
          await supabase
            .from("client_integrations")
            .update({
              last_sync_at: nowISO,
              last_sync_status: integrationStatus,
              last_sync_error: integrationError,
              status: dailyTotalsSucceeded || integrationStatus === "ok" ? "connected" : undefined,
              is_active: true,
              updated_at: nowISO,
            })
            .eq("client_id", clientId)
            .eq("provider", "shopify");
        } catch (e: any) {
          console.warn("[shopify/sync] failed to update integration status:", e?.message || String(e));
        }

        console.log(
          `[shopify/sync] coverageAttempted=${coverageAttempted} coverageRowsUpserted=${coverageRowsUpserted} integrationStatus=${integrationStatus}`
        );
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      source: "shopify",
      start: startDay,
      end: endDay,
      fillZeros,
      clients: resolvedIntegrations?.length ?? 0,
      daysWritten,
      zerosInserted,
      errors,
      results,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, source: "shopify", error: e?.message || String(e) },
      { status: 500 }
    );
  }
}