import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { bucketShopifyOrderDay } from "@/lib/dates";
import { requireCronAuth } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function gidToInventoryItemId(gid: string | null | undefined): number | null {
  // gid: "gid://shopify/InventoryItem/1234567890"
  if (!gid) return null;
  const m = gid.match(/InventoryItem\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function gidToVariantId(gid: string | null | undefined): number | null {
  // gid: "gid://shopify/ProductVariant/1234567890"
  if (!gid) return null;
  const m = gid.match(/ProductVariant\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function inventoryItemIdToGid(id: number): string {
  return `gid://shopify/InventoryItem/${id}`;
}

async function shopifyGraphQL(args: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: any;
}) {
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";
  const url = `https://${args.shopDomain}/admin/api/${apiVersion}/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": args.accessToken,
    },
    body: JSON.stringify({ query: args.query, variables: args.variables || {} }),
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || res.statusText;
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${msg}`);
  }
  if (json?.errors?.length) {
    throw new Error(`Shopify GraphQL: ${json.errors[0]?.message || "Unknown error"}`);
  }
  return json?.data;
}

async function getShopTimeZone(shopDomain: string, accessToken: string): Promise<string> {
  const data = await shopifyGraphQL({
    shopDomain,
    accessToken,
    query: `query ShopTZ { shop { ianaTimezone } }`,
  });
  return (data as any)?.shop?.ianaTimezone || "UTC";
}

const INVENTORY_ITEM_COST_QUERY = `
query InventoryItemCosts($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on InventoryItem {
      id
      unitCost {
        amount
        currencyCode
      }
    }
  }
}
`;

async function fetchInventoryItemUnitCosts(args: {
  shopDomain: string;
  accessToken: string;
  inventoryItemIds: number[];
  throttleMs: number;
}) {
  const { shopDomain, accessToken, inventoryItemIds, throttleMs } = args;
  const unitCostByInventoryId: Record<number, { amount: number | null; currency: string | null }> = {};

  const ids = Array.from(new Set(inventoryItemIds.filter((id) => Number.isFinite(id))));
  const chunkSize = 75;
  let fetched = 0;
  let withCost = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const gqlIds = chunk.map((id) => inventoryItemIdToGid(id));
    const data = await shopifyGraphQL({
      shopDomain,
      accessToken,
      query: INVENTORY_ITEM_COST_QUERY,
      variables: { ids: gqlIds },
    });

    const nodes = (data as any)?.nodes || [];
    for (const node of nodes) {
      if (!node || node.__typename !== "InventoryItem") continue;
      const invId = gidToInventoryItemId(node?.id);
      if (!invId) continue;
      fetched += 1;
      const amtRaw = node?.unitCost?.amount;
      const amt = amtRaw != null ? Number(amtRaw) : null;
      const currency = node?.unitCost?.currencyCode || null;
      if (amt != null && Number.isFinite(amt)) withCost += 1;
      unitCostByInventoryId[invId] = {
        amount: amt != null && Number.isFinite(amt) ? amt : null,
        currency,
      };
    }

    if (throttleMs > 0) await sleep(throttleMs);
  }

  return { unitCostByInventoryId, fetched, withCost, totalRequested: ids.length };
}

/**
 * Pull orders for a date range and aggregate:
 * day + inventory_item_id => units, line_revenue
 *
 * IMPORTANT: This stores NO customer PII. We only store:
 * - day
 * - inventory_item_id / variant_id / sku
 * - units
 * - line_revenue (discounted total)
 */
const ORDERS_WITH_LINEITEMS_QUERY = `
query OrdersWithLineItems($cursor: String, $queryStr: String!) {
  orders(first: 50, after: $cursor, query: $queryStr, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        createdAt
        processedAt
        lineItems(first: 250) {
          edges {
            node {
              quantity
              sku
              discountedTotalSet {
                shopMoney { amount currencyCode }
              }
              variant {
                id
                inventoryItem {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

export async function POST(req: NextRequest) {
  try {
    const auth = requireCronAuth(req);
    if (auth instanceof NextResponse) return auth;

    const supabase = getSupabaseAdmin();
    const url = req.nextUrl;

    const clientId = url.searchParams.get("client_id")?.trim();
    const start = url.searchParams.get("start")?.trim(); // YYYY-MM-DD
    const end = url.searchParams.get("end")?.trim();     // YYYY-MM-DD
    const shopOverride = url.searchParams.get("shop")?.trim();
    const throttleMs = Number(url.searchParams.get("throttleMs") || "200");

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json(
        { ok: false, error: "Missing start or end (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // Load install/token
    // Adjust select columns if your schema differs.
    const { data: install, error: iErr } = await supabase
      .from("shopify_app_installs")
      .select("client_id, shop_domain, access_token, updated_at")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (iErr) throw iErr;

    const shopDomain = (shopOverride || install?.shop_domain || "").trim();
    const accessToken = (install?.access_token || "").trim();

    if (!shopDomain) {
      return NextResponse.json(
        { ok: false, error: `No shop_domain found for client_id=${clientId}` },
        { status: 400 }
      );
    }
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: `No access_token found for client_id=${clientId}, shop=${shopDomain}` },
        { status: 400 }
      );
    }

    // Shopify Admin "orders" search query
    // Use UTC midnight bounds. This keeps it deterministic.
    // Note: Shopify search expects timestamps; this form is commonly accepted.
    const queryStr = `processed_at:>=${start}T00:00:00Z processed_at:<=${end}T23:59:59Z status:any`;

    // Aggregate in memory: key = `${day}|${inventoryItemId}`
    const agg = new Map<
      string,
      {
        day: string;
        inventory_item_id: number;
        variant_id: number | null;
        sku: string | null;
        units: number;
        line_revenue: number;
        currency: string;
      }
    >();

    let cursor: string | null = null;
    let pages = 0;
    let ordersSeen = 0;
    let lineItemsSeen = 0;
    let minCreatedAt = "";
    let maxCreatedAt = "";
    let sampleLogged = false;

    const shopTimeZone = await getShopTimeZone(shopDomain, accessToken);

    while (true) {
      const data = await shopifyGraphQL({
        shopDomain,
        accessToken,
        query: ORDERS_WITH_LINEITEMS_QUERY,
        variables: { cursor, queryStr },
      });

      const conn = data?.orders;
      const edges = conn?.edges || [];
      const pageInfo = conn?.pageInfo;

      pages += 1;

      for (const e of edges) {
        const o = e?.node;
        const createdAt = String(o?.createdAt || "");
        const processedAt = String(o?.processedAt || "");
        const day = bucketShopifyOrderDay({ processedAt, createdAt });
        ordersSeen += 1;

        if (!sampleLogged && day) {
          console.info("[daily-line-items-sync] sample order", {
            id: o?.id,
            createdAt: createdAt || null,
            processedAt: processedAt || null,
            day,
          });
          sampleLogged = true;
        }

        const stamp = processedAt || createdAt;

        if (stamp) {
          if (!minCreatedAt || stamp < minCreatedAt) minCreatedAt = stamp;
          if (!maxCreatedAt || stamp > maxCreatedAt) maxCreatedAt = stamp;
        }

        const liEdges = o?.lineItems?.edges || [];
        for (const le of liEdges) {
          const li = le?.node;
          lineItemsSeen += 1;

          const qty = n(li?.quantity);
          if (qty <= 0) continue;

          const sku = (li?.sku as string | undefined) || null;
          const variantGid = li?.variant?.id as string | undefined;
          const invGid = li?.variant?.inventoryItem?.id as string | undefined;

          const inventoryItemId = gidToInventoryItemId(invGid);
          if (!inventoryItemId) continue;

          const variantId = gidToVariantId(variantGid);

          const amt = li?.discountedTotalSet?.shopMoney?.amount;
          const currencyCode = li?.discountedTotalSet?.shopMoney?.currencyCode || "USD";
          const lineRevenue = amt != null ? Number(amt) : 0;

          const key = `${day}|${inventoryItemId}`;
          const existing = agg.get(key);

          if (existing) {
            existing.units += qty;
            existing.line_revenue += lineRevenue;
            // keep first non-null sku/variant if present
            if (!existing.sku && sku) existing.sku = sku;
            if (!existing.variant_id && variantId) existing.variant_id = variantId;
            // currency should be consistent; keep existing
          } else {
            agg.set(key, {
              day,
              inventory_item_id: inventoryItemId,
              variant_id: variantId,
              sku,
              units: qty,
              line_revenue: lineRevenue,
              currency: currencyCode,
            });
          }
        }
      }

      if (throttleMs > 0) await sleep(throttleMs);

      const hasNext = !!pageInfo?.hasNextPage;
      cursor = pageInfo?.endCursor || null;

      if (!hasNext) break;
      if (pages > 200) throw new Error("Too many pages while syncing line items (safety stop).");
    }

    // Upsert results to Supabase
    const rows = Array.from(agg.values()).map((r) => ({
      client_id: clientId,
      shop_domain: shopDomain,
      day: r.day,
      inventory_item_id: r.inventory_item_id,
      variant_id: r.variant_id,
      sku: r.sku,
      units: Math.round(r.units),
      line_revenue: r.line_revenue,
      currency: r.currency,
      updated_at: new Date().toISOString(),
    }));

    const distinctDays = new Set(rows.map((r) => r.day));

    // Fetch + upsert unit costs for inventory items
    const inventoryItemIds = Array.from(new Set(rows.map((r) => r.inventory_item_id).filter(Boolean)));
    const invToVariant: Record<number, number | null> = {};
    for (const r of rows) {
      if (!r.inventory_item_id) continue;
      if (invToVariant[r.inventory_item_id] == null && r.variant_id) {
        invToVariant[r.inventory_item_id] = r.variant_id;
      }
    }

    const { unitCostByInventoryId, fetched, withCost, totalRequested } =
      await fetchInventoryItemUnitCosts({
        shopDomain,
        accessToken,
        inventoryItemIds,
        throttleMs,
      });

    const unitCostRows = inventoryItemIds.map((invId) => {
      const cost = unitCostByInventoryId[invId];
      return {
        client_id: clientId,
        shop_domain: shopDomain,
        inventory_item_id: invId,
        variant_id: invToVariant[invId] ?? null,
        unit_cost_amount: cost?.amount ?? null,
        updated_at: new Date().toISOString(),
      };
    });

    // Chunk upserts to avoid oversized payloads
    let rowsUpserted = 0;
    const chunkSize = 500;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: upErr } = await supabase
        .from("shopify_daily_line_items")
        .upsert(chunk, { onConflict: "client_id,day,inventory_item_id" });
      if (upErr) throw upErr;
      rowsUpserted += chunk.length;
    }

    let unitCostsUpserted = 0;
    if (unitCostRows.length) {
      for (let i = 0; i < unitCostRows.length; i += chunkSize) {
        const chunk = unitCostRows.slice(i, i + chunkSize);
        const { error: upErr } = await supabase
          .from("shopify_variant_unit_costs")
          .upsert(chunk, { onConflict: "client_id,inventory_item_id" });
        if (upErr) throw upErr;
        unitCostsUpserted += chunk.length;
      }
    }

    console.log(
      `[daily-line-items-sync] unit costs fetched=${fetched}/${totalRequested}, withCost=${withCost}, upserted=${unitCostsUpserted}`
    );
    console.info("[daily-line-items-sync] rows upserted", {
      rowsUpserted,
      unitCostsUpserted,
    });

    return NextResponse.json({
      ok: true,
      source: "shopify-daily-line-items-sync",
      client_id: clientId,
      shop_domain: shopDomain,
      window: { start, end },
      pages,
      ordersSeen,
      lineItemsSeen,
      createdAtRange: { min: minCreatedAt || null, max: maxCreatedAt || null },
      distinctDays: distinctDays.size,
      aggregatedKeys: rows.length,
      rowsUpserted,
      unitCostsRequested: totalRequested,
      unitCostsFetched: fetched,
      unitCostsWithCost: withCost,
      unitCostsUpserted,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
