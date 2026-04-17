import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchAllProductPerformance(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  clientId: string,
  startISO: string,
  endISO: string
) {
  const rows: any[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.rpc("get_product_performance", {
      p_client_id: clientId,
      p_start: startISO,
      p_end: endISO,
      p_limit: pageSize,
      p_offset: offset,
    });

    if (error) {
      throw new Error(error.message || "Failed to load product performance recommendation data");
    }

    const chunk = (data || []) as any[];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return rows;
}

function isoDateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const shopDomain = (url.searchParams.get("shop_domain") || "").trim();
    if (!shopDomain) {
      return NextResponse.json({ ok: false, error: "Missing shop_domain" }, { status: 400 });
    }

    const client_id = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!client_id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6);
    const recommendationStart = new Date(end);
    recommendationStart.setUTCDate(end.getUTCDate() - 89);
    const endISO = isoDateUTC(end);
    const startISO = isoDateUTC(start);
    const recommendationStartISO = isoDateUTC(recommendationStart);

    const supabase = getSupabaseAdmin();

    const { data: unitRows, error: unitErr } = await supabase
      .from("unit_cost_coverage_daily")
      .select("date,units_total,units_with_unit_cost")
      .eq("client_id", client_id)
      .gte("date", startISO)
      .lte("date", endISO);

    if (unitErr) throw new Error(unitErr.message || "Failed to load unit cost coverage");

    const unitTotals = (unitRows ?? []).reduce(
      (acc, row: any) => {
        acc.units += Number(row?.units_total ?? 0);
        acc.unitsWithCost += Number(row?.units_with_unit_cost ?? 0);
        return acc;
      },
      { units: 0, unitsWithCost: 0 }
    );

    const unitCostCoveragePct =
      unitTotals.units > 0 ? unitTotals.unitsWithCost / unitTotals.units : null;

    const { count: catalogVariantCount, error: catalogCountErr } = await supabase
      .from("shopify_variant_unit_costs")
      .select("inventory_item_id", { count: "exact", head: true })
      .eq("client_id", client_id)
      .not("inventory_item_id", "is", null);

    if (catalogCountErr) {
      throw new Error(catalogCountErr.message || "Failed to load Shopify catalog coverage");
    }

    const { count: catalogVariantsWithCostCount, error: catalogWithCostErr } = await supabase
      .from("shopify_variant_unit_costs")
      .select("inventory_item_id", { count: "exact", head: true })
      .eq("client_id", client_id)
      .not("inventory_item_id", "is", null)
      .gt("unit_cost_amount", 0);

    if (catalogWithCostErr) {
      throw new Error(catalogWithCostErr.message || "Failed to load Shopify catalog cost coverage");
    }

    const catalogCoveragePct =
      Number(catalogVariantCount || 0) > 0
        ? Number(catalogVariantsWithCostCount || 0) / Number(catalogVariantCount || 0)
        : null;

    const recommendationRows = await fetchAllProductPerformance(
      supabase,
      client_id,
      recommendationStartISO,
      endISO
    );
    const fullyCoveredRecommendationRows = recommendationRows.filter((row: any) => {
      const revenue = Number(row?.revenue ?? 0);
      const coverage = Number(row?.cogs_coverage_pct ?? 0);
      return revenue > 0 && coverage >= 0.999999;
    });

    const recommendationTotals = fullyCoveredRecommendationRows.reduce(
      (acc, row: any) => {
        acc.revenue += Number(row?.revenue ?? 0);
        acc.profit += Number(row?.profit ?? 0);
        acc.units += Number(row?.units ?? 0);
        acc.products += 1;
        return acc;
      },
      { revenue: 0, profit: 0, units: 0, products: 0 }
    );

    const recommendedFallbackGrossMarginPct =
      recommendationTotals.revenue > 0
        ? Math.max(0, Math.min(1, recommendationTotals.profit / recommendationTotals.revenue))
        : null;

    const { data: effRows, error: effErr } = await supabase
      .from("daily_profit_summary")
      .select("date,revenue,revenue_with_cogs")
      .eq("client_id", client_id)
      .gte("date", startISO)
      .lte("date", endISO);

    if (effErr) throw new Error(effErr.message || "Failed to load effective COGS coverage");

    const effTotals = (effRows ?? []).reduce(
      (acc, row: any) => {
        acc.revenue += Number(row?.revenue ?? 0);
        acc.revenueWithCogs += Number(row?.revenue_with_cogs ?? 0);
        return acc;
      },
      { revenue: 0, revenueWithCogs: 0 }
    );

    const effectiveCogsCoveragePct =
      effTotals.revenue > 0 ? effTotals.revenueWithCogs / effTotals.revenue : null;

    return NextResponse.json({
      ok: true,
      unitCostCoveragePct,
      unitCostCoverageHasRows: (unitRows?.length ?? 0) > 0,
      catalogCoveragePct,
      catalogCoverageHasRows: Number(catalogVariantCount || 0) > 0,
      catalogVariantCount: Number(catalogVariantCount || 0),
      catalogVariantsWithCostCount: Number(catalogVariantsWithCostCount || 0),
      recommendedFallbackGrossMarginPct,
      recommendedFallbackGrossMarginHasRows: recommendationTotals.revenue > 0,
      recommendedFallbackSampleRevenue: recommendationTotals.revenue,
      recommendedFallbackSampleUnits: recommendationTotals.units,
      recommendedFallbackSampleProducts: recommendationTotals.products,
      recommendationRange: { startISO: recommendationStartISO, endISO },
      effectiveCogsCoveragePct,
      range: { startISO, endISO },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
