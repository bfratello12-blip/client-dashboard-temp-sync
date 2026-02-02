import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { addDaysIsoUTC } from "@/lib/dates";

function toNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = (searchParams.get("client_id") || "").trim();
    const eventDate = (searchParams.get("event_date") || "").trim();
    const windowDays = Math.max(1, Number(searchParams.get("window_days") || 7));

    if (!clientId || !eventDate) {
      return NextResponse.json(
        { ok: false, error: "Missing client_id or event_date" },
        { status: 400 }
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return NextResponse.json(
        { ok: false, error: "Invalid event_date (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const afterStart = eventDate;
    const afterEnd = addDaysIsoUTC(afterStart, windowDays - 1);
    const beforeEnd = addDaysIsoUTC(afterStart, -1);
    const beforeStart = addDaysIsoUTC(beforeEnd, -(windowDays - 1));

    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase
      .from("daily_profit_summary")
      .select("date, revenue, orders, paid_spend, contribution_profit")
      .eq("client_id", clientId)
      .gte("date", beforeStart)
      .lte("date", afterEnd)
      .order("date", { ascending: true });

    if (error) {
      throw new Error(error.message || "Failed to fetch daily_profit_summary");
    }

    const beforeAgg = { revenue: 0, orders: 0, paid_spend: 0, contribution_profit: 0 };
    const afterAgg = { revenue: 0, orders: 0, paid_spend: 0, contribution_profit: 0 };

    for (const r of rows || []) {
      const iso = String((r as any).date).slice(0, 10);
      const target = iso >= afterStart && iso <= afterEnd ? afterAgg : iso >= beforeStart && iso <= beforeEnd ? beforeAgg : null;
      if (!target) continue;
      target.revenue += toNum((r as any).revenue);
      target.orders += toNum((r as any).orders);
      target.paid_spend += toNum((r as any).paid_spend);
      target.contribution_profit += toNum((r as any).contribution_profit);
    }

    const toTotals = (agg: typeof beforeAgg) => {
      const revenue = agg.revenue;
      const orders = agg.orders;
      const paid_spend = agg.paid_spend;
      const contribution_profit = agg.contribution_profit;
      const asp = orders > 0 ? revenue / orders : 0;
      const aov = orders > 0 ? revenue / orders : 0;
      const roas = paid_spend > 0 ? revenue / paid_spend : 0;
      const profit_return = paid_spend > 0 ? contribution_profit / paid_spend : 0;
      return { revenue, orders, paid_spend, contribution_profit, asp, aov, roas, profit_return };
    };

    return NextResponse.json({
      ok: true,
      window: { beforeStart, beforeEnd, afterStart, afterEnd },
      before: toTotals(beforeAgg),
      after: toTotals(afterAgg),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
