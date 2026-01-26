import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAuth(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
  if (!secret) return;

  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const ok = bearer === secret || header === secret;
  if (!ok) throw new Error("Unauthorized");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

const VARIANTS_WITH_UNIT_COST_QUERY = `
query VariantsWithUnitCost($cursor: String) {
  productVariants(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        sku
        inventoryItem {
          id
          unitCost {
            amount
            currencyCode
          }
        }
      }
    }
  }
}
`;

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const supabase = getSupabaseAdmin();
    const url = req.nextUrl;

    const clientId = url.searchParams.get("client_id")?.trim();
    const shop = url.searchParams.get("shop")?.trim(); // optional override
    const throttleMs = Number(url.searchParams.get("throttleMs") || "200");

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    // Get install/token
    // Adjust select columns if your shopify_app_installs schema differs.
    const { data: install, error: iErr } = await supabase
      .from("shopify_app_installs")
      .select("client_id, shop_domain, access_token")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (iErr) throw iErr;

    const shopDomain = (shop || install?.shop_domain || "").trim();
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

    let cursor: string | null = null;
    let pages = 0;
    let variantsSeen = 0;
    let rowsUpserted = 0;

    while (true) {
      const data = await shopifyGraphQL({
        shopDomain,
        accessToken,
        query: VARIANTS_WITH_UNIT_COST_QUERY,
        variables: { cursor },
      });

      const conn = data?.productVariants;
      const edges = conn?.edges || [];
      const pageInfo = conn?.pageInfo;

      pages += 1;

      const upserts: any[] = [];
      for (const e of edges) {
        const v = e?.node;
        const variantGid = v?.id as string | undefined;
        const sku = v?.sku as string | undefined;
        const invGid = v?.inventoryItem?.id as string | undefined;

        const inventoryItemId = gidToInventoryItemId(invGid);
        const variantId = gidToVariantId(variantGid);

        if (!inventoryItemId) continue;

        const unitCostAmt = v?.inventoryItem?.unitCost?.amount;
        const currencyCode = v?.inventoryItem?.unitCost?.currencyCode || "USD";

        upserts.push({
          client_id: clientId,
          shop_domain: shopDomain,
          inventory_item_id: inventoryItemId,
          variant_id: variantId,
          sku: sku || null,
          unit_cost: unitCostAmt != null ? Number(unitCostAmt) : null,
          currency: currencyCode,
          source: "shopify_unit_cost",
          updated_at: new Date().toISOString(),
        });
      }

      variantsSeen += edges.length;

      if (upserts.length) {
        const { error: upErr } = await supabase
          .from("shopify_unit_costs")
          .upsert(upserts, { onConflict: "client_id,inventory_item_id" });
        if (upErr) throw upErr;

        rowsUpserted += upserts.length;
      }

      // simple throttle to be nice to Shopify
      if (throttleMs > 0) await sleep(throttleMs);

      const hasNext = !!pageInfo?.hasNextPage;
      cursor = pageInfo?.endCursor || null;

      if (!hasNext) break;

      // hard safety stop (avoid accidental infinite loop)
      if (pages > 200) throw new Error("Too many pages while syncing unit costs (safety stop).");
    }

    return NextResponse.json({
      ok: true,
      source: "shopify-unit-cost-sync",
      client_id: clientId,
      shop_domain: shopDomain,
      pages,
      variantsSeen,
      rowsUpserted,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
