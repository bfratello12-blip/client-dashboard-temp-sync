import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const { data: recommendationRows, error: recommendationErr } = await supabase
      .from("daily_shopify_cogs_coverage")
      .select("date,product_cogs_known,revenue_with_cogs,units_with_cogs")
      .eq("client_id", client_id)
      .gte("date", recommendationStartISO)
      .lte("date", endISO);

    if (recommendationErr) {
      throw new Error(
        recommendationErr.message || "Failed to load fallback gross margin recommendation"
      );
    }

    const recommendationTotals = (recommendationRows ?? []).reduce(
      (acc, row: any) => {
        acc.productCogsKnown += Number(row?.product_cogs_known ?? 0);
        acc.revenueWithCogs += Number(row?.revenue_with_cogs ?? 0);
        acc.unitsWithCogs += Number(row?.units_with_cogs ?? 0);
        acc.daysWithCoverage += Number(row?.revenue_with_cogs ?? 0) > 0 ? 1 : 0;
        return acc;
      },
      { productCogsKnown: 0, revenueWithCogs: 0, unitsWithCogs: 0, daysWithCoverage: 0 }
    );

    const recommendedFallbackGrossMarginPct =
      recommendationTotals.revenueWithCogs > 0
        ? Math.max(
            0,
            Math.min(
              1,
              (recommendationTotals.revenueWithCogs - recommendationTotals.productCogsKnown) /
                recommendationTotals.revenueWithCogs
            )
          )
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
      recommendedFallbackGrossMarginHasRows: recommendationTotals.revenueWithCogs > 0,
      recommendedFallbackSampleUnits: recommendationTotals.unitsWithCogs,
      recommendedFallbackSampleDays: recommendationTotals.daysWithCoverage,
      recommendationRange: { startISO: recommendationStartISO, endISO },
      effectiveCogsCoveragePct,
      range: { startISO, endISO },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
