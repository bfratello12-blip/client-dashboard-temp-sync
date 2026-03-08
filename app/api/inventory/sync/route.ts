import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, jwtVerify } from "jose";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function inventoryItemIdToGid(id: string) {
  return id.startsWith("gid://") ? id : `gid://shopify/InventoryItem/${id}`;
}

function gidToInventoryItemId(gid: string | null | undefined): string {
  if (!gid) return "";
  const m = gid.match(/InventoryItem\/(\d+)/);
  return m?.[1] || "";
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function toSafeAvailable(v: any): number {
  const num = Number(v ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
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

const INVENTORY_LEVELS_QUERY = `
query InventoryLevels($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on InventoryItem {
      id
      inventoryLevels(first: 250) {
        edges {
          node {
            quantities(names: ["available"]) {
              name
              quantity
            }
            location { id }
          }
        }
      }
    }
  }
}
`;

export async function POST(req: NextRequest) {
  try {
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

    if (installErr || !install?.client_id || !install?.access_token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const clientId = install.client_id as string;
    const shopDomain = (install.shop_domain || "").trim();
    const accessToken = (install.access_token || "").trim();

    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - 89);
    const startISO = startDate.toISOString().slice(0, 10);

    const inventoryItems: Array<{ inventory_item_id: any; variant_id: any }> = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("shopify_daily_line_items")
        .select("inventory_item_id, variant_id")
        .eq("client_id", clientId)
        .gte("day", startISO)
        .not("inventory_item_id", "is", null)
        .range(from, from + pageSize - 1);

      if (error) throw error;
      if (!data?.length) break;
      inventoryItems.push(...data);
      if (data.length < pageSize) break;
    }

    const invToVariant = new Map<string, string>();
    const inventoryItemIds: string[] = [];

    for (const row of inventoryItems) {
      const invId = String(row?.inventory_item_id || "").trim();
      if (!invId) continue;
      if (!invToVariant.has(invId) && row?.variant_id != null) {
        const v = String(row.variant_id || "").trim();
        if (v) invToVariant.set(invId, v);
      }
      inventoryItemIds.push(invId);
    }

    const uniqueIds = Array.from(new Set(inventoryItemIds));
    if (!uniqueIds.length) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const availableByInventoryId = new Map<string, number>();
    const missingInventoryIds = new Set<string>();
    const logMissing = (invId: string, reason: string) => {
      if (!invId || missingInventoryIds.has(invId)) return;
      missingInventoryIds.add(invId);
      console.warn("[inventory/sync] missing inventory data", {
        inventory_item_id: invId,
        variant_id: invToVariant.get(invId) ?? null,
        reason,
      });
    };
    const chunkSize = 75;

    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      const chunk = uniqueIds.slice(i, i + chunkSize);
      const data = await shopifyGraphQL({
        shopDomain,
        accessToken,
        query: INVENTORY_LEVELS_QUERY,
        variables: { ids: chunk.map(inventoryItemIdToGid) },
      });

      const nodes = (data as any)?.nodes || [];
      for (const node of nodes) {
        if (!node || node.__typename !== "InventoryItem") continue;
        const invId = gidToInventoryItemId(node?.id);
        if (!invId) continue;
        const edges = node?.inventoryLevels?.edges;
        if (!Array.isArray(edges) || edges.length === 0) {
          logMissing(invId, "missing_inventory_levels");
          availableByInventoryId.set(invId, 0);
          continue;
        }

        let totalAvailable = 0;
        let hadAvailable = false;

        for (const edge of edges) {
          const quantities = edge?.node?.quantities;
          if (!Array.isArray(quantities) || quantities.length === 0) {
            logMissing(invId, "missing_quantities");
            continue;
          }
          const availableEntry = quantities.find((q: any) => q?.name === "available");
          if (!availableEntry) {
            logMissing(invId, "missing_available_entry");
            continue;
          }
          const qtyRaw = Number(availableEntry?.quantity ?? 0);
          if (!Number.isFinite(qtyRaw)) {
            logMissing(invId, "invalid_quantity");
            continue;
          }
          hadAvailable = true;
          totalAvailable += qtyRaw;
        }

        if (!hadAvailable) {
          logMissing(invId, "no_available_quantities");
          totalAvailable = 0;
        }

        availableByInventoryId.set(invId, toSafeAvailable(totalAvailable));
      }
    }

    const now = new Date().toISOString();
    const upsertRows = uniqueIds.map((invId) => {
      const rawAvailable = availableByInventoryId.has(invId)
        ? availableByInventoryId.get(invId)
        : null;
      if (!availableByInventoryId.has(invId)) {
        logMissing(invId, "missing_inventory_item_node");
      }
      const safeAvailable = toSafeAvailable(rawAvailable);
      return {
      client_id: clientId,
      variant_id: invToVariant.get(invId) ?? null,
      inventory_item_id: invId,
      available: safeAvailable,
      updated_at: now,
      };
    });

    let rowsUpserted = 0;
    const upsertChunk = 500;
    for (let i = 0; i < upsertRows.length; i += upsertChunk) {
      const chunk = upsertRows.slice(i, i + upsertChunk);
      const { error: upErr } = await supabase
        .from("shopify_variant_inventory")
        .upsert(chunk, { onConflict: "client_id,variant_id" });
      if (upErr) throw upErr;
      rowsUpserted += chunk.length;
    }

    return NextResponse.json({ ok: true, updated: rowsUpserted });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}