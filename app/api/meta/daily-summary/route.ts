// app/api/meta/daily-summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isDay(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const client_id = url.searchParams.get("client_id") ?? "";
    const day = url.searchParams.get("day") ?? "";

    if (!client_id || !isUUID(client_id)) {
      return NextResponse.json(
        { ok: false, source: "meta", error: "Invalid client_id (uuid required)" },
        { status: 400 }
      );
    }

    if (!day || !isDay(day)) {
      return NextResponse.json(
        { ok: false, source: "meta", error: `Invalid day format: ${day}` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("daily_metrics")
      .select(
        "client_id,date,source,spend,impressions,clicks,conversions,revenue"
      )
      .eq("client_id", client_id)
      .eq("date", day)
      .eq("source", "meta")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, source: "meta", error: "Supabase query failed", details: error },
        { status: 500 }
      );
    }

    const spend = Number(data?.spend ?? 0);
    const impressions = Number(data?.impressions ?? 0);
    const clicks = Number(data?.clicks ?? 0);
    const conversions = Number((data as any)?.conversions ?? 0);
    const revenue = Number((data as any)?.revenue ?? 0);

    return NextResponse.json({
      ok: true,
      source: "meta",
      client_id,
      day,
      spend,
      impressions,
      clicks,
      conversions,
      revenue,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, source: "meta", error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}


