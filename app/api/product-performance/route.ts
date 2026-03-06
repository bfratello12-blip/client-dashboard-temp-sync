import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, jwtVerify } from "jose";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VariantMeta = {
  product_title?: string;
  variant_title?: string;
  sku?: string;
  image_url?: string;
  admin_product_url?: string;
  admin_variant_url?: string;
};

const VARIANT_META_TTL_MS = 6 * 60 * 60 * 1000;
const variantMetaCache = new Map<string, { value: VariantMeta; expiresAt: number }>();

function normalizeShopDomain(shop: string) {
  const s = (shop || "").trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

function shopFromDest(dest?: string) {
  if (!dest) return "";
  try {
    const hostname = new URL(dest).hostname;
    return normalizeShopDomain(hostname);
  } catch {
    return "";
  }
}

async function shopFromSessionToken(token: string): Promise<string> {
  const secret = process.env.SHOPIFY_OAUTH_CLIENT_SECRET || "";
  let payload: { dest?: string } | null = null;

  if (secret) {
    try {
      const { payload: verified } = await jwtVerify(
        token,
        new TextEncoder().encode(secret)
      );
      payload = verified as { dest?: string };
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    try {
      payload = decodeJwt(token) as { dest?: string };
    } catch {
      payload = null;
    }
  }

  return shopFromDest(payload?.dest || "");
}

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInclusive(startISO: string, endISO: string) {
  const s = new Date(`${startISO}T00:00:00Z`).getTime();
  const e = new Date(`${endISO}T00:00:00Z`).getTime();
  const diff = Math.round((e - s) / (24 * 3600 * 1000));
  return Math.max(1, diff + 1);
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

function toVariantGid(id: string) {
  return id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`;
}

function gidToVariantId(gid: string) {
  const m = gid.match(/ProductVariant\/(\d+)/);
  return m?.[1] || gid;
}

function gidToProductId(gid: string) {
  const m = gid.match(/Product\/(\d+)/);
  return m?.[1] || "";
}

function storeHandleFromShopDomain(shopDomain: string) {
  const s = String(shopDomain || "").trim().toLowerCase();
  return s.endsWith(".myshopify.com") ? s.replace(".myshopify.com", "") : "";
}

function buildAdminUrls(shopDomain: string, productId: string, variantId: string) {
  const handle = storeHandleFromShopDomain(shopDomain);
  if (handle) {
    const productUrl = `https://admin.shopify.com/store/${handle}/products/${productId}`;
    const variantUrl = `https://admin.shopify.com/store/${handle}/products/${productId}?variant=${variantId}`;
    return { productUrl, variantUrl };
  }
  const productUrl = `https://${shopDomain}/admin/products/${productId}`;
  const variantUrl = `https://${shopDomain}/admin/products/${productId}?variant=${variantId}`;
  return { productUrl, variantUrl };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = (searchParams.get("start") || "").trim();
    const end = (searchParams.get("end") || "").trim();
    const limitRaw = (searchParams.get("limit") || "").trim();
    const pageRaw = (searchParams.get("page") || "").trim();
    const limit = Math.max(1, Number(limitRaw || 100) || 100);
    const page = Math.max(1, Number(pageRaw || 1) || 1);
    const offset = (page - 1) * limit;

    if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) {
      return NextResponse.json({ ok: false, error: "Invalid or missing start/end" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1] || "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const shop = await shopFromSessionToken(token);
    if (!shop) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = supabaseAdmin();
    const { data: install, error: installErr } = await supabase
      .from("shopify_app_installs")
      .select("client_id, shop_domain, access_token")
      .eq("shop_domain", shop)
      .maybeSingle();

    if (installErr || !install?.client_id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("get_product_performance", {
      p_client_id: install.client_id,
      p_start: start,
      p_end: end,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const { data: countData, error: countErr } = await supabase.rpc(
      "get_product_performance_count",
      {
        p_client_id: install.client_id,
        p_start: start,
        p_end: end,
      }
    );

    if (countErr) {
      return NextResponse.json({ ok: false, error: countErr.message }, { status: 500 });
    }

    const totalCount = Number(countData || 0);

    const { data: totalsData, error: totalsErr } = await supabase.rpc(
      "get_product_performance_totals",
      {
        p_client_id: install.client_id,
        p_start: start,
        p_end: end,
      }
    );

    if (totalsErr) {
      return NextResponse.json({ ok: false, error: totalsErr.message }, { status: 500 });
    }

    const rows = (data || []) as any[];
    const totalsRow = Array.isArray(totalsData) ? totalsData[0] : totalsData;
    const totalRevenueAll = Number(totalsRow?.total_revenue || 0);
    const totalUnitsAll = Number(totalsRow?.total_units || 0);
    const totalProfitAll = Number(totalsRow?.total_profit || 0);
    const rangeDays = daysInclusive(start, end);
    const prevEnd = addDaysIso(start, -1);
    const prevStart = addDaysIso(prevEnd, -(rangeDays - 1));
    const prevLimit = Math.max(limit, 100);

    const { data: prevData } = await supabase.rpc("get_product_performance", {
      p_client_id: install.client_id,
      p_start: prevStart,
      p_end: prevEnd,
      p_limit: prevLimit,
    });

    const prevRows = (prevData || []) as any[];
    const prevByVariant = new Map<string, any>();
    for (const r of prevRows) {
      const id = String(r?.variant_id || "");
      if (id) prevByVariant.set(id, r);
    }

    const totalRevenue = totalRevenueAll;
    const totalUnits = totalUnitsAll;

    for (const r of rows) {
      const revenue = Number(r?.revenue || 0);
      const profit = Number(r?.profit || 0);
      const units = Number(r?.units || 0);
      const prev = prevByVariant.get(String(r?.variant_id || ""));
      const prevRevenue = Number(prev?.revenue || 0);

      r.profit_margin_pct = revenue > 0 ? profit / revenue : 0;
      r.revenue_share_pct = totalRevenue > 0 ? revenue / totalRevenue : 0;
      r.units_per_day = rangeDays > 0 ? units / rangeDays : 0;
      r.prev_revenue = prevRevenue;
      r.trend_pct =
        prevRevenue > 0
          ? (revenue - prevRevenue) / prevRevenue
          : revenue > 0
          ? 1
          : 0;

      r.on_hand_units = null;
      r.days_of_inventory = null;
    }

    if (rows.length) {
      const rowVariantIds = Array.from(
        new Set(rows.map((r) => String(r?.variant_id || "")).filter(Boolean))
      );
      const rowInventoryItemIds = Array.from(
        new Set(rows.map((r) => String(r?.inventory_item_id || "")).filter(Boolean))
      );

      const inventoryRows: any[] = [];
      const chunkSize = 200;

      if (rowVariantIds.length && rowInventoryItemIds.length) {
        for (let i = 0; i < Math.max(rowVariantIds.length, rowInventoryItemIds.length); i += chunkSize) {
          const variantChunk = rowVariantIds.slice(i, i + chunkSize);
          const invChunk = rowInventoryItemIds.slice(i, i + chunkSize);
          const orParts = [] as string[];
          if (variantChunk.length) orParts.push(`variant_id.in.(${variantChunk.join(",")})`);
          if (invChunk.length) orParts.push(`inventory_item_id.in.(${invChunk.join(",")})`);
          if (!orParts.length) continue;

          const { data: invData, error: invErr } = await supabase
            .from("shopify_variant_inventory")
            .select("variant_id, inventory_item_id, available")
            .eq("client_id", install.client_id)
            .or(orParts.join(","));

          if (invErr) throw invErr;
          if (invData?.length) inventoryRows.push(...invData);
        }
      } else if (rowVariantIds.length) {
        for (let i = 0; i < rowVariantIds.length; i += chunkSize) {
          const chunk = rowVariantIds.slice(i, i + chunkSize);
          const { data: invData, error: invErr } = await supabase
            .from("shopify_variant_inventory")
            .select("variant_id, inventory_item_id, available")
            .eq("client_id", install.client_id)
            .in("variant_id", chunk);
          if (invErr) throw invErr;
          if (invData?.length) inventoryRows.push(...invData);
        }
      } else if (rowInventoryItemIds.length) {
        for (let i = 0; i < rowInventoryItemIds.length; i += chunkSize) {
          const chunk = rowInventoryItemIds.slice(i, i + chunkSize);
          const { data: invData, error: invErr } = await supabase
            .from("shopify_variant_inventory")
            .select("variant_id, inventory_item_id, available")
            .eq("client_id", install.client_id)
            .in("inventory_item_id", chunk);
          if (invErr) throw invErr;
          if (invData?.length) inventoryRows.push(...invData);
        }
      }

      if (inventoryRows.length) {
        const availableByInventoryId = new Map<string, number>();
        const availableByVariantId = new Map<string, number>();

        for (const inv of inventoryRows) {
          const invId = String(inv?.inventory_item_id || "");
          const varId = String(inv?.variant_id || "");
          const available = Number(inv?.available);
          if (invId) availableByInventoryId.set(invId, Number.isFinite(available) ? available : 0);
          if (varId) availableByVariantId.set(varId, Number.isFinite(available) ? available : 0);
        }

        for (const r of rows) {
          const invId = String(r?.inventory_item_id || "");
          const varId = String(r?.variant_id || "");
          const available =
            (invId && availableByInventoryId.has(invId)
              ? availableByInventoryId.get(invId)
              : undefined) ??
            (varId && availableByVariantId.has(varId)
              ? availableByVariantId.get(varId)
              : undefined);

          r.on_hand_units = available ?? null;
          r.days_of_inventory =
            available != null && Number(r?.units_per_day || 0) > 0
              ? available / Number(r?.units_per_day || 0)
              : null;
        }
      }
    }
    const shopDomain = (install?.shop_domain || "").trim();
    const accessToken = (install?.access_token || "").trim();

    if (shopDomain && accessToken && rows.length) {
      const variantIds = Array.from(
        new Set(rows.map((r) => String(r?.variant_id || "")).filter(Boolean))
      );

      const productByVariant = new Map<string, VariantMeta>();
      const now = Date.now();
      const toFetch: string[] = [];

      for (const id of variantIds) {
        const key = `${shopDomain}:${id}`;
        const cached = variantMetaCache.get(key);
        if (cached && cached.expiresAt > now) {
          productByVariant.set(id, cached.value);
        } else {
          toFetch.push(id);
        }
      }

      const chunkSize = 50;
      const query = `
        query Variants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              title
              sku
              image { url }
              product { id title featuredImage { url } }
            }
          }
        }
      `;

      for (let i = 0; i < toFetch.length; i += chunkSize) {
        const chunk = toFetch.slice(i, i + chunkSize).map(toVariantGid);
        const data = await shopifyGraphQL({
          shopDomain,
          accessToken,
          query,
          variables: { ids: chunk },
        });

        const nodes = (data?.nodes || []) as any[];
        for (const node of nodes) {
          if (!node?.id) continue;
          const variantGid = String(node.id);
          const variantId = gidToVariantId(variantGid);
          const productId = gidToProductId(String(node?.product?.id || ""));
          const imageUrl = node?.image?.url || node?.product?.featuredImage?.url || "";
          const title = node?.product?.title || "";
          const variantTitle = node?.title || "";
          const sku = node?.sku || "";
          const urls = productId
            ? buildAdminUrls(shopDomain, productId, variantId)
            : { productUrl: "", variantUrl: "" };

          const meta: VariantMeta = {
            product_title: title || null,
            variant_title: variantTitle || null,
            sku: sku || null,
            image_url: imageUrl || null,
            admin_product_url: urls.productUrl || null,
            admin_variant_url: urls.variantUrl || null,
          };

          if (variantId) {
            productByVariant.set(variantId, meta);
            variantMetaCache.set(`${shopDomain}:${variantId}`, {
              value: meta,
              expiresAt: now + VARIANT_META_TTL_MS,
            });
          }
        }
      }

      for (const r of rows) {
        const rawId = String(r?.variant_id || "");
        const info = productByVariant.get(rawId) || productByVariant.get(gidToVariantId(rawId));
        if (info) {
          r.product_title = info.product_title || null;
          r.variant_title = info.variant_title || null;
          r.sku = info.sku || null;
          r.image_url = info.image_url || null;
          r.admin_product_url = info.admin_product_url || null;
          r.admin_variant_url = info.admin_variant_url || null;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      meta: {
        start,
        end,
        prev_start: prevStart,
        prev_end: prevEnd,
        range_days: rangeDays,
        total_revenue: totalRevenue,
        total_units: totalUnits,
        total_profit: totalProfitAll,
      },
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
      rows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
