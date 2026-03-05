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
    const limit = Math.max(1, Math.min(500, Number(limitRaw || 100) || 100));

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
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (data || []) as any[];
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

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
