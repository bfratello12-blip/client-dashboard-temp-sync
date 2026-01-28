// app/api/cron/rolling-30/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isoDateUTC, dateRangeInclusiveUTC } from "@/lib/dates";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rolling profitability builder
 * - Reads raw daily_metrics (shopify revenue/orders/units + paid spend from google/meta)
 * - Reads client_cost_settings (per-client variable cost assumptions)
 * - Writes derived daily_profit_summary rows
 *
 * Note: "mer" in daily_profit_summary is currently revenue / paid_spend (i.e. ROAS).
 * "profit_mer" is contribution_profit / paid_spend.
 * contribution_profit here is AFTER paid spend and variable costs.
 */

function requireCronAuth(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
  if (!secret) return; // allow if not configured

  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const qp = req.nextUrl.searchParams.get("token")?.trim() || "";

  const ok = bearer === secret || qp === secret || header === secret;
  if (!ok) throw new Error("Unauthorized");
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
  const n = Number(v);
  const frac = n > 1 ? n / 100 : n;
  return clamp01(frac);
}

function daysInMonth(iso: string): number {
  // iso: YYYY-MM-DD
  const [y, m] = iso.split("-").map((p) => Number(p));
  const d = new Date(Date.UTC(y, m, 0)); // day 0 => last day of prev month => last day of month m
  return d.getUTCDate();
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

  // Optional: actual product-level COGS coverage (e.g. from Shopify inventoryItem.unitCost)
  // - productCogsKnown: total actual COGS dollars for covered lines
  // - revenueWithCogs: total revenue dollars for those covered lines
  // - unitsWithCogs: total units for those covered lines
  productCogsKnown?: number;
  revenueWithCogs?: number;
  unitsWithCogs?: number;
  estimatedCogsMissing?: number;
}) {
  const { date, revenue, orders, units, paidSpend, cs } = args;

  const productCogsKnown = n((args as any).productCogsKnown);
  const revenueWithCogs = n((args as any).revenueWithCogs);
  const unitsWithCogs = n((args as any).unitsWithCogs);
  const estimatedCogsMissing = (args as any).estimatedCogsMissing;

  // --- COGS ---
  // We support a blended model:
  // - If we know product-level COGS for some portion of revenue (productCogsKnown),
  //   we only estimate COGS for the remaining (unknown) portion.
  // - Otherwise we estimate COGS for the full day (legacy behavior).

  const gm = normalizePct(cs?.default_gross_margin_pct);
  const avgCogsPerUnit = n(cs?.avg_cogs_per_unit);

  const coveredRevenue = Math.max(0, Math.min(revenue, revenueWithCogs));
  const coveredUnits = Math.max(0, Math.min(units, unitsWithCogs));

  const unknownRevenue = Math.max(0, revenue - coveredRevenue);
  const unknownUnits = Math.max(0, units - coveredUnits);

  // Estimate COGS for the unknown portion using your existing settings
  let est_cogs_unknown = 0;
  if (unknownUnits > 0 && avgCogsPerUnit > 0) {
    est_cogs_unknown = unknownUnits * avgCogsPerUnit;
  } else if (gm != null && Number.isFinite(Number(gm))) {
    est_cogs_unknown = unknownRevenue * (1 - clamp01(Number(gm)));
  } else {
    // Conservative default if no settings exist: assume 50% COGS rate
    est_cogs_unknown = unknownRevenue * 0.5;
  }

  // Total COGS used in profit calc for the day
  // - If coverage is complete, honor estimatedCogsMissing (if present).
  // - Otherwise, always compute fallback for the uncovered portion.
  const coverageComplete = revenueWithCogs === revenue && revenue > 0;
  const est_cogs = coverageComplete && Number.isFinite(Number(estimatedCogsMissing))
    ? productCogsKnown + n(estimatedCogsMissing)
    : productCogsKnown > 0
      ? productCogsKnown + est_cogs_unknown
      : (() => {
          // Legacy behavior: estimate for full revenue/units
          if (units > 0 && avgCogsPerUnit > 0) return units * avgCogsPerUnit;
          if (gm != null) return revenue * (1 - gm);
          return revenue * 0.5;
        })();

  // Coverage metrics
  const cogs_coverage_pct = revenue > 0 ? coveredRevenue / revenue : 0;

  // --- Processing fees ---
  const feePct = n(cs?.processing_fee_pct) || 0;
  const feeFixed = n(cs?.processing_fee_fixed) || 0;
  const est_processing_fees = revenue * feePct + orders * feeFixed;

  // --- Fulfillment / pick-pack ---
  const pickPack = n(cs?.pick_pack_per_order);
  const est_fulfillment_costs = orders * pickPack;

  // --- Other variable costs ---
  const shipping = n(cs?.shipping_subsidy_per_order);
  const materials = n(cs?.materials_per_order);
  const otherVarPct = n(cs?.other_variable_pct_revenue);

  const est_other_variable_costs =
    orders * shipping + orders * materials + revenue * otherVarPct;

  // --- Other fixed costs (daily allocation) ---
  // You already store other_fixed_per_day, so no monthly allocation needed here.
  // If you later add monthly fixed costs, allocate: monthly / daysInMonth(date).
  const est_other_fixed_costs = n(cs?.other_fixed_per_day);

  const true_variable_cost =
    est_cogs +
    est_processing_fees +
    est_fulfillment_costs +
    est_other_variable_costs +
    paidSpend;

  // contribution_profit in your table is AFTER paid spend and costs:
  const contribution_profit =
    revenue -
    (est_cogs +
      est_processing_fees +
      est_fulfillment_costs +
      est_other_variable_costs +
      est_other_fixed_costs +
      paidSpend);

  // "mer" in your table is revenue / paid_spend (ROAS)
  const mer = paidSpend > 0 ? revenue / paidSpend : 0;

  // profit_mer is contribution_profit / paid_spend
  const profit_mer = paidSpend > 0 ? contribution_profit / paidSpend : 0;

  return {
    client_id: cs?.client_id, // caller will override
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

    // Coverage fields already exist in your daily_profit_summary table
    product_cogs_known: productCogsKnown,
    revenue_with_cogs: coveredRevenue,
    cogs_coverage_pct,
  };
}

export async function POST(req: NextRequest) {
  try {
    requireCronAuth(req);

    const supabase = getSupabaseAdmin();

    const url = req.nextUrl;
    const clientId = url.searchParams.get("client_id")?.trim() || "";
    const start = url.searchParams.get("start")?.trim() || "";
    const end = url.searchParams.get("end")?.trim() || "";
    const fillZeros = url.searchParams.get("fillZeros")?.trim() === "1";

    const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    // Window (UTC)
    // - If end is not provided: default to yesterday (UTC) to avoid partial "today" data
    // - If start is not provided: default to 30 days prior to end
    if (start || end) {
      if (!start || !end || !isISODate(start) || !isISODate(end)) {
        return NextResponse.json(
          { ok: false, error: "Missing/invalid start/end (YYYY-MM-DD)." },
          { status: 400 }
        );
      }
    }

    let endISO = end;
    let startISO = start;
    if (!endISO) {
      const endDate = new Date(Date.now() - 24 * 3600 * 1000);
      endISO = isoDateUTC(endDate);
      if (!startISO) {
        startISO = isoDateUTC(new Date(endDate.getTime() - 30 * 24 * 3600 * 1000));
      }
    }

    if (startISO > endISO) {
      return NextResponse.json({ ok: false, error: "start must be <= end." }, { status: 400 });
    }

    const days = dateRangeInclusiveUTC(startISO, endISO);

    // Determine clients to process
    let clientIds: string[] = [];
    if (clientId) {
      clientIds = [clientId];
    } else {
      const { data: clients, error: cErr } = await supabase
        .from("clients")
        .select("id")
        .limit(5000);
      if (cErr) throw cErr;
      clientIds = (clients || []).map((c: any) => String(c.id));
    }

    let clientsProcessed = 0;
    let rowsUpserted = 0;
    let coverageRowsFetched = 0;
    const errors: any[] = [];

    for (const cid of clientIds) {
      try {
        // Load cost settings for client (optional)
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

        // Fetch raw daily_metrics for the date range for these sources
        const { data: metricsRows, error: mErr } = await supabase
          .from("daily_metrics")
          .select("date,source,spend,revenue,orders,units")
          .eq("client_id", cid)
          .gte("date", startISO)
          .lte("date", endISO)
          .in("source", ["shopify", "google", "meta"]);
        if (mErr) throw mErr;

        const coverageByDate: Record<
          string,
          {
            product_cogs_known: number;
            revenue_with_cogs: number;
            units_with_cogs: number;
            estimated_cogs_missing: number;
          }
        > = {};

        try {
          const { data: lineItems, error: liErr } = await supabase
            .from("shopify_daily_line_items")
            .select("day,variant_id,units,line_revenue")
            .eq("client_id", cid)
            .gte("day", startISO)
            .lte("day", endISO);
          if (liErr) throw liErr;

          const variantIds = Array.from(
            new Set((lineItems || []).map((r: any) => String(r.variant_id || "")).filter(Boolean))
          );

          const unitCostByVariant: Record<string, number | null> = {};
          const chunkSize = 500;
          for (let i = 0; i < variantIds.length; i += chunkSize) {
            const chunk = variantIds.slice(i, i + chunkSize);
            const { data: costRows, error: costErr } = await supabase
              .from("shopify_variant_unit_costs")
              .select("variant_id,unit_cost_amount")
              .eq("client_id", cid)
              .in("variant_id", chunk);
            if (costErr) throw costErr;
            for (const row of costRows || []) {
              const vid = String((row as any).variant_id || "");
              if (!vid) continue;
              unitCostByVariant[vid] = (row as any).unit_cost_amount ?? null;
            }
          }

          for (const r of lineItems || []) {
            const d = toDayKey((r as any).day);
            if (!d) continue;
            const variantId = String((r as any).variant_id || "");
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

            const unitCostAmount = unitCostByVariant[variantId];
            if (unitCostAmount != null) {
              coverageByDate[d].product_cogs_known += units * n(unitCostAmount);
              coverageByDate[d].revenue_with_cogs += lineRevenue;
              coverageByDate[d].units_with_cogs += units;
            } else {
              coverageByDate[d].estimated_cogs_missing += lineRevenue * (1 - gmFallbackRate);
            }
          }

          coverageRowsFetched += Object.keys(coverageByDate).length;
        } catch (e: any) {
          console.warn(
            "[rolling-30] cogs coverage join failed:",
            e?.message || String(e)
          );
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
          if (source === "shopify") {
            byDate[d].revenue += n((r as any).revenue);
            byDate[d].orders += n((r as any).orders);
            byDate[d].units += n((r as any).units);
          } else if (source === "google" || source === "meta") {
            byDate[d].paidSpend += n((r as any).spend);
          }
        }

        // Fill missing dates
        if (fillZeros) {
          for (const d of days) {
            if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0, units: 0, paidSpend: 0 };
          }
        }

        const upserts = Object.entries(byDate).map(([d, v]) => {
          const coverage = coverageByDate[toDayKey(d)];
          const base = computeDailyProfitSummary({
            date: d,
            revenue: v.revenue,
            orders: v.orders,
            units: v.units,
            paidSpend: v.paidSpend,
            cs: cs ? { ...cs, client_id: cid } : ({ client_id: cid } as any),

            productCogsKnown: n(coverage?.product_cogs_known),
            revenueWithCogs: n(coverage?.revenue_with_cogs),
            unitsWithCogs: n(coverage?.units_with_cogs),
            estimatedCogsMissing: n(coverage?.estimated_cogs_missing),
          });

          return {
            ...base,
            client_id: cid,
          };
        });

        if (upserts.length) {
          const { error: upErr } = await supabase
            .from("daily_profit_summary")
            .upsert(upserts, { onConflict: "client_id,date" });
          if (upErr) throw upErr;
          rowsUpserted += upserts.length;
        }

        clientsProcessed += 1;
      } catch (e: any) {
        errors.push({ client_id: cid, error: e?.message || String(e) });
      }
    }

    console.log(`[rolling-30] cogs coverage rows fetched: ${coverageRowsFetched}`);

    return NextResponse.json({
      ok: errors.length === 0,
      source: "rolling-30-profit",
      window: { start: startISO, end: endISO },
      fillZeros,
      clients: clientsProcessed,
      rowsUpserted,
      errors,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}