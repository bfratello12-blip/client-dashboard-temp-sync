import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getShopFromRequest,
} from "@/lib/requestAuth";

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
    const sortKeyRaw = (searchParams.get("sortKey") || "").trim();
    const sortDirRaw = (searchParams.get("sortDir") || "").trim().toLowerCase();
    const search = (searchParams.get("search") || "").trim().toLowerCase();
    const requestedClientId = (searchParams.get("client_id") || "").trim();
    const filterRaw = (searchParams.get("filter") || "all").trim().toLowerCase();
    const filter =
      filterRaw === "rising" ||
      filterRaw === "declining" ||
      filterRaw === "low_inventory" ||
      filterRaw === "high_margin" ||
      filterRaw === "losing_products"
        ? filterRaw
        : "all";
    const limit = Math.max(1, Number(limitRaw || 100) || 100);
    const page = Math.max(1, Number(pageRaw || 1) || 1);
    const offset = (page - 1) * limit;

    const allowedSortKeys = new Set([
      "units",
      "units_per_day",
      "revenue",
      "revenue_share_pct",
      "est_cogs",
      "profit",
      "profit_per_unit",
      "profit_margin_pct",
      "trend_pct",
      "days_of_inventory",
      "cogs_coverage_pct",
    ]);

    const sortKey = allowedSortKeys.has(sortKeyRaw) ? sortKeyRaw : "profit";
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

    if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) {
      return NextResponse.json({ ok: false, error: "Invalid or missing start/end" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    let install: { client_id: string; shop_domain?: string | null; access_token?: string | null } | null = null;

    const shop = await getShopFromRequest(req);
    if (shop) {
      const { data: shopInstall, error: installErr } = await supabase
        .from("shopify_app_installs")
        .select("client_id, shop_domain, access_token")
        .eq("shop_domain", shop)
        .maybeSingle();

      if (installErr || !shopInstall?.client_id) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      install = {
        client_id: String(shopInstall.client_id),
        shop_domain: shopInstall.shop_domain,
        access_token: shopInstall.access_token,
      };
    } else {
      if (!requestedClientId) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      const { data: clientInstall } = await supabase
        .from("shopify_app_installs")
        .select("client_id, shop_domain, access_token")
        .eq("client_id", requestedClientId)
        .limit(1)
        .maybeSingle();

      install = {
        client_id: requestedClientId,
        shop_domain: clientInstall?.shop_domain ?? null,
        access_token: clientInstall?.access_token ?? null,
      };
    }

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

    const totalsRow = Array.isArray(totalsData) ? totalsData[0] : totalsData;
    const totalRevenueAll = Number(totalsRow?.total_revenue || 0);
    const totalUnitsAll = Number(totalsRow?.total_units || 0);
    const totalProfitAll = Number(totalsRow?.total_profit || 0);
    const rangeDays = daysInclusive(start, end);
    const prevEnd = addDaysIso(start, -1);
    const prevStart = addDaysIso(prevEnd, -(rangeDays - 1));
    const chunkSize = 1000;
    async function fetchAllPerformance(startISO: string, endISO: string) {
      const out: any[] = [];
      for (let off = 0; ; off += chunkSize) {
        const { data: chunk, error: chunkErr } = await supabase.rpc(
          "get_product_performance",
          {
            p_client_id: install.client_id,
            p_start: startISO,
            p_end: endISO,
            p_limit: chunkSize,
            p_offset: off,
          }
        );
        if (chunkErr) throw chunkErr;
        const rowsChunk = (chunk || []) as any[];
        if (!rowsChunk.length) break;
        out.push(...rowsChunk);
        if (rowsChunk.length < chunkSize) break;
      }
      return out;
    }

    const allRows = await fetchAllPerformance(start, end);
    const prevRows = await fetchAllPerformance(prevStart, prevEnd);
    const prevByVariant = new Map<string, any>();
    for (const r of prevRows) {
      const id = String(r?.variant_id || "");
      if (id) prevByVariant.set(id, r);
    }

    const totalRevenue = totalRevenueAll;
    const totalUnits = totalUnitsAll;

    for (const r of allRows) {
      const revenue = Number(r?.revenue || 0);
      const profit = Number(r?.profit || 0);
      const units = Number(r?.units || 0);
      const prev = prevByVariant.get(String(r?.variant_id || ""));
      const prevRevenue = Number(prev?.revenue || 0);

      r.profit_margin_pct = revenue > 0 ? profit / revenue : 0;
      r.revenue_share_pct = totalRevenue > 0 ? revenue / totalRevenue : 0;
      r.units_per_day = rangeDays > 0 ? units / rangeDays : 0;
      r.profit_per_unit = units > 0 ? profit / units : 0;
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

    if (allRows.length) {
      const rowVariantIds = Array.from(
        new Set(allRows.map((r) => String(r?.variant_id || "")).filter(Boolean))
      );
      const rowInventoryItemIds = Array.from(
        new Set(allRows.map((r) => String(r?.inventory_item_id || "")).filter(Boolean))
      );

      const inventoryRows: any[] = [];
      const invChunkSize = 200;

      if (rowVariantIds.length && rowInventoryItemIds.length) {
        for (let i = 0; i < Math.max(rowVariantIds.length, rowInventoryItemIds.length); i += invChunkSize) {
          const variantChunk = rowVariantIds.slice(i, i + invChunkSize);
          const invChunk = rowInventoryItemIds.slice(i, i + invChunkSize);
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
        for (let i = 0; i < rowVariantIds.length; i += invChunkSize) {
          const chunk = rowVariantIds.slice(i, i + invChunkSize);
          const { data: invData, error: invErr } = await supabase
            .from("shopify_variant_inventory")
            .select("variant_id, inventory_item_id, available")
            .eq("client_id", install.client_id)
            .in("variant_id", chunk);
          if (invErr) throw invErr;
          if (invData?.length) inventoryRows.push(...invData);
        }
      } else if (rowInventoryItemIds.length) {
        for (let i = 0; i < rowInventoryItemIds.length; i += invChunkSize) {
          const chunk = rowInventoryItemIds.slice(i, i + invChunkSize);
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

        for (const r of allRows) {
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

    const shouldFetchMeta = !!search;
    if (shopDomain && accessToken && allRows.length && shouldFetchMeta) {
      const variantIds = Array.from(
        new Set(allRows.map((r) => String(r?.variant_id || "")).filter(Boolean))
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

      for (const r of allRows) {
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

    const searchLower = search.toLowerCase();
    const matchesSearch = (r: any) => {
      if (!searchLower) return true;
      const hay = [r.product_title, r.variant_title, r.sku, r.variant_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(searchLower);
    };

    const matchesFilter = (r: any) => {
      switch (filter) {
        case "rising":
          return Number(r?.trend_pct || 0) > 0;
        case "declining":
          return Number(r?.trend_pct || 0) < 0;
        case "low_inventory":
          return r.days_of_inventory != null && Number(r.days_of_inventory) <= 7;
        case "high_margin":
          return Number(r?.profit_margin_pct || 0) >= 0.4;
        case "losing_products":
          return Number(r?.profit || 0) < 0;
        default:
          return true;
      }
    };

    const matchedRows = allRows.filter((r) => matchesSearch(r) && matchesFilter(r));

    const toNum = (v: any) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
    const sortedRows = [...matchedRows].sort((a, b) => {
      if (sortKey === "days_of_inventory") {
        const aVal = a.days_of_inventory;
        const bVal = b.days_of_inventory;
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (sortDir === "asc") return Number(aVal) > Number(bVal) ? 1 : -1;
        return Number(aVal) < Number(bVal) ? 1 : -1;
      }

      const aVal = toNum((a as any)[sortKey]);
      const bVal = toNum((b as any)[sortKey]);
      if (sortDir === "asc") return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

    const productsAnalyzed = matchedRows.length;
    const revenueCovered = matchedRows.reduce((s, r) => s + Number(r?.revenue || 0), 0);
    const profitCovered = matchedRows.reduce((s, r) => s + Number(r?.profit || 0), 0);
    const avgMarginPct = revenueCovered > 0 ? profitCovered / revenueCovered : 0;
    const revenueCoveragePct = totalRevenueAll > 0 ? revenueCovered / totalRevenueAll : 0;
    const profitCoveragePct = totalProfitAll !== 0 ? profitCovered / totalProfitAll : 0;

    const totalCount = productsAnalyzed;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const pageRows = sortedRows.slice(offset, offset + limit);

    if (shopDomain && accessToken && pageRows.length && !shouldFetchMeta) {
      const variantIds = Array.from(
        new Set(pageRows.map((r) => String(r?.variant_id || "")).filter(Boolean))
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

      for (const r of pageRows) {
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
        totalPages,
      },
      summary: {
        productsAnalyzed,
        revenueCovered,
        profitCovered,
        avgMarginPct,
        revenueCoveragePct,
        profitCoveragePct,
      },
      rows: pageRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
