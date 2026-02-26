import { NextRequest, NextResponse } from "next/server";
import { dateRangeInclusiveUTC } from "@/lib/dates";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireCronAuth } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_SOURCES = ["google", "google_ads", "googleads"];
const META_SOURCES = ["meta", "meta_ads", "facebook", "fb"];
const AD_SOURCES = [...GOOGLE_SOURCES, ...META_SOURCES];

function normalizeAdSource(source: string): "google" | "meta" | null {
  const s = String(source || "").toLowerCase();
  if (GOOGLE_SOURCES.includes(s)) return "google";
  if (META_SOURCES.includes(s)) return "meta";
  return null;
}

type CostSettingsRow = {
  client_id: string;
  default_gross_margin_pct: number | null;
  avg_cogs_per_unit: number | null;
  processing_fee_pct: number | null;
  processing_fee_fixed: number | null;
  pick_pack_per_order: number | null;
  shipping_subsidy_per_order: number | null;
  materials_per_order: number | null;
  other_variable_pct_revenue: number | null;
  other_fixed_per_day: number | null;
};

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normalizePct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const num = Number(v);
  const frac = num > 1 ? num / 100 : num;
  return clamp01(frac);
}

async function fetchAllSupabase<T>(
  builderFactory: (from: number, to: number) => any,
  pageSize = 1000
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;
  while (true) {
    const query = builderFactory(offset, offset + pageSize - 1);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

function toDayKey(v: any): string {
  const s = String(v || "");
  return s ? s.slice(0, 10) : "";
}

function computeDailyProfitSummary(args: {
  date: string;
  revenue: number;
  orders: number;
  units: number;
  paidSpend: number;
  cs: CostSettingsRow | null;
  productCogsKnown?: number;
  revenueWithCogs?: number;
  unitsWithCogs?: number;
  estimatedCogsMissing?: number;
}) {
  const { date, revenue, orders, units, paidSpend, cs } = args;

  const productCogsKnownRaw = n((args as any).productCogsKnown);
  const revenueWithCogsRaw = n((args as any).revenueWithCogs);
  const unitsWithCogs = n((args as any).unitsWithCogs);
  const estimatedCogsMissing = (args as any).estimatedCogsMissing;

  const gm = normalizePct(cs?.default_gross_margin_pct);
  const avgCogsPerUnit = n(cs?.avg_cogs_per_unit);
  const fallbackMargin = gm != null ? gm : 0.5;

  const revenueWithCogsClamped = Math.min(revenueWithCogsRaw || 0, revenue);
  const coveredRevenue = Math.max(0, revenueWithCogsClamped);
  const coveredUnits = Math.max(0, Math.min(units, unitsWithCogs));

  const uncoveredRevenue = Math.max(0, revenue - revenueWithCogsClamped);

  const scale = revenueWithCogsRaw > 0 ? revenueWithCogsClamped / revenueWithCogsRaw : 0;
  const productCogsKnown = productCogsKnownRaw * scale;

  const fallbackCogsPct = 1 - clamp01(Number(fallbackMargin));
  const fallbackCogs = uncoveredRevenue * fallbackCogsPct;

  let est_cogs = productCogsKnown + fallbackCogs;
  est_cogs = Math.min(Math.max(est_cogs, 0), revenue);

  const coveragePctRaw = revenue > 0 ? revenueWithCogsRaw / revenue : 0;
  const coveragePct = Math.min(Math.max(coveragePctRaw, 0), 1);
  const cogs_coverage_pct = coveragePct;

  if (coveragePctRaw > 1.001) {
    console.warn("[shopify/recompute] coverage_raw > 1", {
      date,
      revenue,
      revenue_with_cogs_raw: revenueWithCogsRaw,
    });
  }

  const feePct = n(cs?.processing_fee_pct) || 0;
  const feeFixed = n(cs?.processing_fee_fixed) || 0;
  const est_processing_fees = revenue * feePct + orders * feeFixed;

  const pickPack = n(cs?.pick_pack_per_order);
  const est_fulfillment_costs = orders * pickPack;

  const shipping = n(cs?.shipping_subsidy_per_order);
  const materials = n(cs?.materials_per_order);
  const otherVarPct = n(cs?.other_variable_pct_revenue);

  const est_other_variable_costs =
    orders * shipping + orders * materials + revenue * otherVarPct;

  const est_other_fixed_costs = n(cs?.other_fixed_per_day);

  const contribution_profit =
    revenue -
    (est_cogs +
      est_processing_fees +
      est_fulfillment_costs +
      est_other_variable_costs +
      est_other_fixed_costs +
      paidSpend);

  const mer = paidSpend > 0 ? revenue / paidSpend : 0;
  const profit_mer = paidSpend > 0 ? contribution_profit / paidSpend : 0;

  return {
    row: {
      client_id: cs?.client_id,
      date,
      revenue,
      orders,
      units,
      paid_spend: paidSpend,
      mer,
      est_cogs,
      est_processing_fees,
      est_fulfillment_costs,
      est_other_variable_costs,
      est_other_fixed_costs,
      contribution_profit,
      profit_mer,
      product_cogs_known: productCogsKnown,
      revenue_with_cogs: coveredRevenue,
      cogs_coverage_pct,
    },
    debug: {
      date,
      revenue,
      revenue_with_cogs_raw: revenueWithCogsRaw,
      revenue_with_cogs_clamped: coveredRevenue,
      scale,
      coverage_raw: coveragePctRaw,
      coverage_clamped: coveragePct,
      uncovered_revenue: uncoveredRevenue,
      product_cogs_known_raw: productCogsKnownRaw,
      product_cogs_known: productCogsKnown,
      fallback_cogs: fallbackCogs,
      est_cogs,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireCronAuth(req);
    if (auth) return auth;

    const start = req.nextUrl.searchParams.get("start")?.trim() || "";
    const end = req.nextUrl.searchParams.get("end")?.trim() || "";
    const clientIdParam = req.nextUrl.searchParams.get("client_id")?.trim() || "";
    if (!start || !end) {
      return NextResponse.json(
        { ok: false, error: "Missing start/end (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const days = dateRangeInclusiveUTC(start, end);
    if (!days.length) {
      return NextResponse.json(
        { ok: false, error: "Invalid date range" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const metricsClients = await fetchAllSupabase<{ client_id: string }>((from, to) =>
      supabase
        .from("daily_metrics")
        .select("client_id")
        .in("source", ["shopify", ...AD_SOURCES])
        .gte("date", start)
        .lte("date", end)
    );

    const lineItemClients = await fetchAllSupabase<{ client_id: string }>((from, to) =>
      supabase
        .from("shopify_daily_line_items")
        .select("client_id")
        .gte("day", start)
        .lte("day", end)
    );

    const clientIds = clientIdParam
      ? [clientIdParam]
      : Array.from(
          new Set(
            [...metricsClients, ...lineItemClients]
              .map((r) => String(r?.client_id || ""))
              .filter(Boolean)
          )
        );

    console.info("[shopify/recompute] clients", { client_ids: clientIds });

    let profitRowsUpserted = 0;
    let coverageRowsUpserted = 0;
    let clientsProcessed = 0;
    const debugRows: any[] = [];

    for (const cid of clientIds) {
      // Cost settings
      const { data: csRow, error: csErr } = await supabase
        .from("client_cost_settings")
        .select(
          "client_id,default_gross_margin_pct,avg_cogs_per_unit,processing_fee_pct,processing_fee_fixed,pick_pack_per_order,shipping_subsidy_per_order,materials_per_order,other_variable_pct_revenue,other_fixed_per_day"
        )
        .eq("client_id", cid)
        .maybeSingle();
      if (csErr) throw csErr;

      const cs: CostSettingsRow | null = csRow ? ({ ...csRow } as any) : null;
      const gmFallback = normalizePct(cs?.default_gross_margin_pct);
      const gmFallbackRate = gmFallback != null ? gmFallback : 0.5;

      const { data: metricsRows, error: mErr } = await supabase
        .from("daily_metrics")
        .select("date,source,spend,revenue,orders,units")
        .eq("client_id", cid)
        .gte("date", start)
        .lte("date", end)
        .in("source", ["shopify", ...AD_SOURCES]);
      if (mErr) throw mErr;

      const lineItems = await fetchAllSupabase<any>((from, to) =>
        supabase
          .from("shopify_daily_line_items")
          .select("day,variant_id,inventory_item_id,units,line_revenue")
          .eq("client_id", cid)
          .gte("day", start)
          .lte("day", end)
      );

      const coverageByDate: Record<
        string,
        {
          product_cogs_known: number;
          revenue_with_cogs: number;
          units_with_cogs: number;
          estimated_cogs_missing: number;
        }
      > = {};
      const unitsWithUnitCostByDay: Record<string, number> = {};

      const inventoryItemIds = Array.from(
        new Set(
          (lineItems || [])
            .map((r: any) => Number((r as any).inventory_item_id))
            .filter((v: any) => Number.isFinite(v))
        )
      );
      const variantIds = Array.from(
        new Set(
          (lineItems || [])
            .map((r: any) => Number((r as any).variant_id))
            .filter((v: any) => Number.isFinite(v))
        )
      );

      const unitCostByVariant = new Map<number, number | null>();
      const unitCostByInventoryItem = new Map<number, number | null>();
      const chunkSize = 500;

      for (let i = 0; i < inventoryItemIds.length; i += chunkSize) {
        const chunk = inventoryItemIds.slice(i, i + chunkSize);
        const { data: costRows, error: costErr } = await supabase
          .from("shopify_variant_unit_costs")
          .select("inventory_item_id,variant_id,unit_cost_amount")
          .eq("client_id", cid)
          .in("inventory_item_id", chunk);
        if (costErr) throw costErr;
        for (const row of costRows || []) {
          const iid = Number((row as any).inventory_item_id);
          if (Number.isFinite(iid)) {
            unitCostByInventoryItem.set(iid, (row as any).unit_cost_amount ?? null);
          }
          const vid = Number((row as any).variant_id);
          if (Number.isFinite(vid) && !unitCostByVariant.has(vid)) {
            unitCostByVariant.set(vid, (row as any).unit_cost_amount ?? null);
          }
        }
      }

      for (let i = 0; i < variantIds.length; i += chunkSize) {
        const chunk = variantIds.slice(i, i + chunkSize);
        const { data: costRows, error: costErr } = await supabase
          .from("shopify_variant_unit_costs")
          .select("variant_id,unit_cost_amount")
          .eq("client_id", cid)
          .in("variant_id", chunk);
        if (costErr) throw costErr;
        for (const row of costRows || []) {
          const vid = Number((row as any).variant_id);
          if (!Number.isFinite(vid)) continue;
          if (!unitCostByVariant.has(vid)) {
            unitCostByVariant.set(vid, (row as any).unit_cost_amount ?? null);
          }
        }
      }

      for (const r of lineItems || []) {
        const d = String((r as any).day || "");
        if (!d) continue;
        const variantId = Number((r as any).variant_id);
        const inventoryItemId = Number((r as any).inventory_item_id);
        const units = n((r as any).units);
        const lineRevenue = n((r as any).line_revenue);

        if (!coverageByDate[d]) {
          coverageByDate[d] = {
            product_cogs_known: 0,
            revenue_with_cogs: 0,
            units_with_cogs: 0,
            estimated_cogs_missing: 0,
          };
        }

        if (!unitsWithUnitCostByDay[d]) {
          unitsWithUnitCostByDay[d] = 0;
        }

        const unitCostAmount = Number.isFinite(inventoryItemId)
          ? unitCostByInventoryItem.get(inventoryItemId)
          : undefined;
        const fallbackUnitCost = Number.isFinite(variantId) ? unitCostByVariant.get(variantId) : undefined;
        const chosenCost = unitCostAmount != null ? unitCostAmount : fallbackUnitCost;

        if (chosenCost != null && Number.isFinite(Number(chosenCost)) && Number(chosenCost) > 0) {
          coverageByDate[d].product_cogs_known += units * n(chosenCost);
          coverageByDate[d].revenue_with_cogs += lineRevenue;
          if (unitCostAmount != null && Number(unitCostAmount) > 0) {
            unitsWithUnitCostByDay[d] += units;
          }
        } else {
          coverageByDate[d].estimated_cogs_missing += lineRevenue * (1 - gmFallbackRate);
        }
      }

      const byDate: Record<
        string,
        { revenue: number; orders: number; units: number; paidSpend: number }
      > = {};

      for (const r of metricsRows || []) {
        const d = toDayKey((r as any).date);
        if (!d) continue;
        if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0, units: 0, paidSpend: 0 };

        const source = String((r as any).source || "");
        const adSource = normalizeAdSource(source);
        if (source === "shopify") {
          byDate[d].revenue += n((r as any).revenue);
          byDate[d].orders += n((r as any).orders);
          byDate[d].units += n((r as any).units);
        } else if (adSource) {
          byDate[d].paidSpend += n((r as any).spend);
        }
      }

      // Cap revenue_with_cogs and units_with_cogs using the day's Shopify revenue/units.
      // SQL verification:
      // select max(dsc.revenue_with_cogs / nullif(dps.revenue,0)) as max_coverage
      // from public.daily_profit_summary dps
      // join public.daily_shopify_cogs_coverage dsc
      //   on dsc.client_id = dps.client_id and dsc.date = dps.date
      // where dps.client_id = '<client_id>'
      //   and dps.date between '<start>' and '<end>';
      const coverageRows = Object.entries(coverageByDate)
        .map(([day, v]) => {
          const dayRevenue = Number(byDate[day]?.revenue ?? 0) || 0;
          const dayUnits = Number(byDate[day]?.units ?? 0) || 0;
          const rawRevenueWithCogs = n(v.revenue_with_cogs);
          const rawUnitsWithCogs = n(v.units_with_cogs);

          const cappedRevenueWithCogs = Math.min(rawRevenueWithCogs, dayRevenue);
          const cappedUnitsWithCogs = dayUnits > 0 ? Math.min(rawUnitsWithCogs, dayUnits) : rawUnitsWithCogs;

          if (rawRevenueWithCogs > dayRevenue) {
            console.warn("[shopify/recompute] cogs coverage capped", {
              client_id: cid,
              date: day,
              raw_revenue_with_cogs: rawRevenueWithCogs,
              day_revenue: dayRevenue,
              capped_revenue_with_cogs: cappedRevenueWithCogs,
            });
          }

          return {
            client_id: cid,
            date: day,
            product_cogs_known: n(v.product_cogs_known),
            revenue_with_cogs: cappedRevenueWithCogs,
            units_with_cogs: cappedUnitsWithCogs,
          };
        })
        .filter((r) => r.product_cogs_known > 0 || r.revenue_with_cogs > 0 || r.units_with_cogs > 0);

      if (coverageRows.length) {
        const { error: cErr } = await supabase
          .from("daily_shopify_cogs_coverage")
          .upsert(coverageRows, { onConflict: "client_id,date" });
        if (cErr) throw cErr;
        coverageRowsUpserted += coverageRows.length;
      }

      const upserts = days.map((d) => {
        if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0, units: 0, paidSpend: 0 };
        const coverage = coverageByDate[d];
        const computed = computeDailyProfitSummary({
          date: d,
          revenue: byDate[d].revenue,
          orders: byDate[d].orders,
          units: byDate[d].units,
          paidSpend: byDate[d].paidSpend,
          cs: cs ? { ...cs, client_id: cid } : ({ client_id: cid } as any),
          productCogsKnown: n(coverage?.product_cogs_known),
          revenueWithCogs: n(coverage?.revenue_with_cogs),
          unitsWithCogs: n(coverage?.units_with_cogs),
          estimatedCogsMissing: n(coverage?.estimated_cogs_missing),
        });
        debugRows.push({ client_id: cid, ...computed.debug });
        const unitsWithCogsRaw = n(unitsWithUnitCostByDay[d]);
        const unitsWithCogs = Math.min(unitsWithCogsRaw, n(byDate[d]?.units));
        return {
          ...computed.row,
          client_id: cid,
          est_cogs: computed.debug.est_cogs,
          product_cogs_known: computed.debug.product_cogs_known,
          revenue_with_cogs: computed.debug.revenue_with_cogs_clamped,
          units_with_cogs: unitsWithCogs,
        };
      });

      if (upserts.length) {
        const { error: upErr } = await supabase
          .from("daily_profit_summary")
          .upsert(upserts, { onConflict: "client_id,date" });
        if (upErr) throw upErr;
        profitRowsUpserted += upserts.length;
      }

      console.info("[shopify/recompute] client done", {
        client_id: cid,
        profitRows: upserts.length,
        coverageRows: coverageRows.length,
      });

      clientsProcessed += 1;
    }

    const updatedCounts = {
      clientsProcessed,
      daily_profit_summary: profitRowsUpserted,
      daily_shopify_cogs_coverage: coverageRowsUpserted,
    };

    console.info("[shopify/recompute] done", updatedCounts);

    return NextResponse.json({ ok: true, range: { start, end }, updatedCounts, debug: debugRows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
