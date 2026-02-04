import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoDateUTC(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const client_id = (url.searchParams.get("client_id") || "").trim();
    if (!client_id) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6);
    const endISO = isoDateUTC(end);
    const startISO = isoDateUTC(start);

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
      effectiveCogsCoveragePct,
      range: { startISO, endISO },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
