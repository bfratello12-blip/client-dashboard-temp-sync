import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isRequestAuthorizedForClient, resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CampaignPerfRow = {
  date: string;
  campaign_id: string;
  campaign_name: string;
  source: string;
  ts: number;
  spend: number;
  revenue: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversion_value: number;
};

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = (searchParams.get("start") || "").trim();
    const end = (searchParams.get("end") || "").trim();
    const shopDomain = (searchParams.get("shop_domain") || "").trim();
    const source = (searchParams.get("source") || "").trim().toLowerCase(); // "google", "meta", or ""

    if (!isIsoDate(start) || !isIsoDate(end)) {
      return NextResponse.json(
        { ok: false, error: "Invalid start/end. Expected YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const clientId = await resolveClientIdFromShopDomainParam(shopDomain);
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Client not found or not installed" }, { status: 404 });
    }

    // Check authorization
    const allowed = await isRequestAuthorizedForClient(req, clientId);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Build query
    const supabase = supabaseAdmin();
    let q = supabase
      .from("daily_campaign_metrics")
      .select("date, campaign_id, campaign_name, source, spend, revenue, clicks, impressions, conversions, conversion_value")
      .eq("client_id", clientId)
      .gte("date", start)
      .lte("date", end);

    if (source) {
      q = q.eq("source", source);
    }

    const { data, error } = await q.order("date", { ascending: false }).order("campaign_name", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows: CampaignPerfRow[] = (data ?? []).map((row: any) => ({
      date: row.date,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      source: row.source,
      ts: new Date(`${row.date}T00:00:00Z`).getTime(),
      spend: Number(row.spend || 0),
      revenue: Number(row.revenue || 0),
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      conversions: Number(row.conversions || 0),
      conversion_value: Number(row.conversion_value || 0),
    }));

    // Group by campaign and compute summary stats
    const byCampaign = new Map<
      string,
      {
        campaign_id: string;
        campaign_name: string;
        source: string;
        days: number;
        spend: number;
        revenue: number;
        clicks: number;
        impressions: number;
        conversions: number;
        conversion_value: number;
        roas: number;
        cpc: number;
        ctr: number;
        profit: number;
        profit_margin_pct: number;
      }
    >();

    for (const row of rows) {
      const key = `${row.campaign_id}|${row.source}`;
      const existing = byCampaign.get(key) || {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        source: row.source,
        days: 0,
        spend: 0,
        revenue: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        conversion_value: 0,
        roas: 0,
        cpc: 0,
        ctr: 0,
        profit: 0,
        profit_margin_pct: 0,
      };

      existing.days += 1;
      existing.spend += row.spend;
      existing.revenue += row.revenue;
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.conversions += row.conversions;
      existing.conversion_value += row.conversion_value;

      byCampaign.set(key, existing);
    }

    // Calculate derived metrics
    const campaigns = Array.from(byCampaign.values()).map((c) => {
      const roas = c.spend > 0 ? c.revenue / c.spend : 0;
      const cpc = c.clicks > 0 ? c.spend / c.clicks : 0;
      const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
      const profit = c.revenue - c.spend;
      const profit_margin_pct = c.revenue > 0 ? (profit / c.revenue) * 100 : 0;

      return {
        ...c,
        roas: Number(roas.toFixed(2)),
        cpc: Number(cpc.toFixed(2)),
        ctr: Number(ctr.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        profit_margin_pct: Number(profit_margin_pct.toFixed(1)),
      };
    });

    return NextResponse.json({
      ok: true,
      start,
      end,
      client_id: clientId,
      count: campaigns.length,
      campaigns,
      rawRows: rows,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
