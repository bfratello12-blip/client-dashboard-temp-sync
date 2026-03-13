import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getFirstClientIdForSupabaseUser,
  getShopFromRequest,
  getSupabaseUserIdFromRequest,
  supabaseUserHasClientAccess,
} from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "organic" | "direct" | "paid" | "unknown";

type ChannelPerfRow = {
  date: string;
  organic: number;
  direct: number;
  paid: number;
  unknown: number;
  ad_spend: number;
  ts: number;
};

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeChannel(value: string): ChannelKey {
  const v = String(value || "").trim().toLowerCase();
  if (v === "organic" || v === "direct" || v === "paid") return v;
  return "unknown";
}

function ensureDate(map: Map<string, ChannelPerfRow>, date: string): ChannelPerfRow {
  const existing = map.get(date);
  if (existing) return existing;

  const row: ChannelPerfRow = {
    date,
    organic: 0,
    direct: 0,
    paid: 0,
    unknown: 0,
    ad_spend: 0,
    ts: new Date(`${date}T00:00:00Z`).getTime(),
  };
  map.set(date, row);
  return row;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = (searchParams.get("start") || "").trim();
    const end = (searchParams.get("end") || "").trim();
    const requestedClientId = (searchParams.get("client_id") || "").trim();

    if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) {
      return NextResponse.json({ ok: false, error: "Invalid or missing start/end" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    let clientId = "";

    const shop = await getShopFromRequest(req);
    if (shop) {
      const { data: install, error: installErr } = await supabase
        .from("shopify_app_installs")
        .select("client_id")
        .eq("shop_domain", shop)
        .maybeSingle();

      if (installErr || !install?.client_id) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      clientId = String(install.client_id);
    } else {
      const userId = await getSupabaseUserIdFromRequest(req);
      if (!userId) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      const targetClientId = requestedClientId || (await getFirstClientIdForSupabaseUser(userId)) || "";
      if (!targetClientId) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      const allowed = await supabaseUserHasClientAccess(userId, targetClientId);
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      clientId = targetClientId;
    }

    const { data: channelRows, error: channelErr } = await supabase
      .from("daily_shopify_channel_metrics")
      .select("date, channel, revenue")
      .eq("client_id", clientId)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true });

    if (channelErr) {
      return NextResponse.json({ ok: false, error: channelErr.message }, { status: 500 });
    }

    const { data: spendRows, error: spendErr } = await supabase
      .from("daily_metrics")
      .select("date, spend")
      .eq("client_id", clientId)
      .in("source", ["google", "meta"])
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true });

    if (spendErr) {
      return NextResponse.json({ ok: false, error: spendErr.message }, { status: 500 });
    }

    const merged = new Map<string, ChannelPerfRow>();

    for (const row of channelRows || []) {
      const date = String((row as any)?.date || "");
      if (!isIsoDate(date)) continue;

      const channel = normalizeChannel(String((row as any)?.channel || ""));
      const revenue = Number((row as any)?.revenue || 0) || 0;

      const out = ensureDate(merged, date);
      out[channel] += revenue;
    }

    for (const row of spendRows || []) {
      const date = String((row as any)?.date || "");
      if (!isIsoDate(date)) continue;

      const spend = Number((row as any)?.spend || 0) || 0;
      const out = ensureDate(merged, date);
      out.ad_spend += spend;
    }

    const rows = Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
