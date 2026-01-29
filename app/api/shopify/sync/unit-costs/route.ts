import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseGidId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const parts = gid.split("/");
  return parts.length ? parts[parts.length - 1] : null;
}

function normalizeShop(shop: string): string {
  const s = (shop || "").trim().toLowerCase();
  const noProto = s.replace(/^https?:\/\//, "");
  const noPath = noProto.split("/")[0];
  return noPath;
}

async function shopifyGraphQL<T>(
  shop: string,
  accessToken: string,
  apiVersion: string,
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(
      `Shopify GraphQL error: HTTP ${res.status}$${
        json?.errors?.[0]?.message ? ` - ${json.errors[0].message}` : ""
      }`
    );
  }

  if (json?.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors[0].message}`);
  }

  return json.data as T;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const shopRaw = (url.searchParams.get("shop") || "").trim();
    const clientIdParam = (url.searchParams.get("client_id") || "").trim();
    const limitProducts = Math.max(1, Number(url.searchParams.get("limit_products") || 50));

    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: "Missing client_id" },
        { status: 400 }
      );
    }

    const shop = normalizeShop(shopRaw);
    if (!shop || !shop.endsWith(".myshopify.com")) {
      return NextResponse.json(
        { ok: false, error: "Missing/invalid shop (must be *.myshopify.com)" },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    const { data: install, error: installErr } = await supabase
      .from("shopify_app_installs")
      .select("client_id, shop_domain, access_token")
      .eq("client_id", clientIdParam)
      .eq("shop_domain", shop)
      .maybeSingle();

    if (installErr) {
      return NextResponse.json({ ok: false, error: installErr.message }, { status: 500 });
    }
    if (!install?.access_token) {
      return NextResponse.json(
        { ok: false, error: "No Shopify install found for client_id + shop" },
        { status: 400 }
      );
    }

    const client_id = clientIdParam || String(install.client_id || "");
    if (!client_id) {
      return NextResponse.json(
        { ok: false, error: "Missing client_id for shop" },
        { status: 400 }
      );
    }

    const accessToken = String(install.access_token);
    const apiVersion = "2024-10";

    const query = `
      query ProductUnitCosts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              variants(first: 100) {
                edges {
                  node {
                    id
                    sku
                    inventoryItem {
                      id
                      unitCost { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    let after: string | null = null;
    let products_scanned = 0;
    let variants_upserted = 0;
    let null_cost_variants = 0;
    let pages = 0;

    while (true) {
      pages += 1;
      const data = await shopifyGraphQL<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: any }>;
        };
      }>(shop, accessToken, apiVersion, query, { first: limitProducts, after });

      const edges = data?.products?.edges || [];
      const pageInfo = data?.products?.pageInfo;

      products_scanned += edges.length;

      const rows: any[] = [];

      for (const edge of edges) {
        const product = edge?.node;
        const productId = parseGidId(product?.id);
        const variants = product?.variants?.edges || [];

        for (const v of variants) {
          const variant = v?.node;
          const variantId = parseGidId(variant?.id);
          if (!variantId) continue;

          const inventoryItem = variant?.inventoryItem || null;
          const inventoryItemId = parseGidId(inventoryItem?.id) || null;
          const unitCost = inventoryItem?.unitCost || null;
          const unitCostAmount = unitCost?.amount ?? null;
          const unitCostCurrency = unitCost?.currencyCode ?? null;

          if (unitCostAmount == null) null_cost_variants += 1;

          rows.push({
            client_id,
            shop_domain: shop,
            product_id: productId ? String(productId) : null,
            variant_id: String(variantId),
            inventory_item_id: inventoryItemId ? String(inventoryItemId) : null,
            sku: variant?.sku ?? null,
            unit_cost_amount: unitCostAmount,
            unit_cost_currency: unitCostCurrency,
            updated_at: new Date().toISOString(),
          });
        }
      }

      if (rows.length) {
        const { error: upErr } = await supabase
          .from("shopify_variant_unit_costs")
          .upsert(rows, { onConflict: "client_id,variant_id" });
        if (upErr) throw upErr;
        variants_upserted += rows.length;
      }

      console.log(
        `[shopify/unit-costs] page=${pages} products=${edges.length} variants=${rows.length}`
      );

      if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) break;
      after = pageInfo.endCursor;
    }

    return NextResponse.json({
      ok: true,
      shop,
      client_id,
      products_scanned,
      variants_upserted,
      null_cost_variants,
      pages,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
