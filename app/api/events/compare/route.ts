import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { addDaysIsoUTC } from "@/lib/dates";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

type WindowAggregate = {
  revenue: number;
  orders: number;
  paid_spend: number;
  contribution_profit: number;
};

type PlatformAggregate = Record<"meta" | "google", { spend: number; revenue: number }>;

const SUPPORTED_AD_SOURCES = ["meta", "meta_ads", "facebook", "fb", "google", "google_ads", "googleads"];
const GOOGLE_SOURCES = new Set(["google", "google_ads", "googleads"]);
const META_SOURCES = new Set(["meta", "meta_ads", "facebook", "fb"]);

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAdSource(source: unknown): keyof PlatformAggregate | null {
  const value = String(source || "").toLowerCase();
  if (META_SOURCES.has(value)) return "meta";
  if (GOOGLE_SOURCES.has(value)) return "google";
  return null;
}

function createPlatformAggregate(): PlatformAggregate {
  return {
    meta: { spend: 0, revenue: 0 },
    google: { spend: 0, revenue: 0 },
  };
}

function averagePlatformRoas(platforms: Array<{ spend: number; revenue: number }>) {
  const roasValues = platforms
    .map(({ spend, revenue }) => (spend > 0 ? revenue / spend : null))
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (roasValues.length === 0) return 0;
  return roasValues.reduce((total, value) => total + value, 0) / roasValues.length;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shopDomain = (searchParams.get("shop_domain") || "").trim();
    const eventDate = (searchParams.get("event_date") || "").trim();
    const windowDays = Math.max(1, Number(searchParams.get("window_days") || 7));

    if (!shopDomain || !eventDate) {
      return NextResponse.json(
        { ok: false, error: "Missing shop_domain or event_date" },
        { status: 400 }
      );
    }

    const clientId = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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

    const { data: adRows, error: adError } = await supabase
      .from("daily_metrics")
      .select("date, source, spend, revenue")
      .eq("client_id", clientId)
      .in("source", SUPPORTED_AD_SOURCES)
      .gte("date", beforeStart)
      .lte("date", afterEnd)
      .order("date", { ascending: true });

    if (adError) {
      throw new Error(adError.message || "Failed to fetch daily_metrics");
    }

    const beforeAgg: WindowAggregate = { revenue: 0, orders: 0, paid_spend: 0, contribution_profit: 0 };
    const afterAgg: WindowAggregate = { revenue: 0, orders: 0, paid_spend: 0, contribution_profit: 0 };
    const beforePlatformAgg = createPlatformAggregate();
    const afterPlatformAgg = createPlatformAggregate();

    const getWindowKey = (iso: string): "before" | "after" | null => {
      if (iso >= afterStart && iso <= afterEnd) return "after";
      if (iso >= beforeStart && iso <= beforeEnd) return "before";
      return null;
    };

    for (const r of (rows || []) as Array<{ date: string; revenue: number | null; orders: number | null; paid_spend: number | null; contribution_profit: number | null }>) {
      const iso = String(r.date).slice(0, 10);
      const target = getWindowKey(iso) === "after" ? afterAgg : getWindowKey(iso) === "before" ? beforeAgg : null;
      if (!target) continue;
      target.revenue += toNum(r.revenue);
      target.orders += toNum(r.orders);
      target.paid_spend += toNum(r.paid_spend);
      target.contribution_profit += toNum(r.contribution_profit);
    }

    for (const r of (adRows || []) as Array<{ date: string; source: string | null; spend: number | null; revenue: number | null }>) {
      const iso = String(r.date).slice(0, 10);
      const windowKey = getWindowKey(iso);
      if (!windowKey) continue;
      const source = normalizeAdSource(r.source);
      if (!source) continue;
      const target = windowKey === "after" ? afterPlatformAgg : beforePlatformAgg;
      target[source].spend += toNum(r.spend);
      target[source].revenue += toNum(r.revenue);
    }

    const toTotals = (agg: WindowAggregate, platformAgg: PlatformAggregate) => {
      const revenue = agg.revenue;
      const orders = agg.orders;
      const paid_spend = agg.paid_spend;
      const contribution_profit = agg.contribution_profit;
      const asp = orders > 0 ? revenue / orders : 0;
      const aov = orders > 0 ? revenue / orders : 0;
      const roas = averagePlatformRoas([platformAgg.meta, platformAgg.google]);
      const profit_return = paid_spend > 0 ? contribution_profit / paid_spend : 0;
      return { revenue, orders, paid_spend, contribution_profit, asp, aov, roas, profit_return };
    };

    return NextResponse.json({
      ok: true,
      window: { beforeStart, beforeEnd, afterStart, afterEnd },
      before: toTotals(beforeAgg, beforePlatformAgg),
      after: toTotals(afterAgg, afterPlatformAgg),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
