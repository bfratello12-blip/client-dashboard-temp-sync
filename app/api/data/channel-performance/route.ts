import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, jwtVerify } from "jose";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChannelKey = "organic" | "direct" | "paid" | "unknown";

type ChannelPerfRow = {
  date: string;
  organic: number;
  direct: number;
  paid: number;
  unknown: number;
  adSpend: number;
};

function normalizeShopDomain(shop: string) {
  const s = (shop || "").trim().toLowerCase();
  if (!s) return "";
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

function shopFromDest(dest?: string) {
  if (!dest) return "";
  try {
    const hostname = new URL(dest).hostname;
    return normalizeShopDomain(hostname);
  } catch {
    return "";
  }
}

async function shopFromSessionToken(token: string): Promise<string> {
  const secret = process.env.SHOPIFY_OAUTH_CLIENT_SECRET || "";
  let payload: { dest?: string } | null = null;

  if (secret) {
    try {
      const { payload: verified } = await jwtVerify(
        token,
        new TextEncoder().encode(secret)
      );
      payload = verified as { dest?: string };
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    try {
      payload = decodeJwt(token) as { dest?: string };
    } catch {
      payload = null;
    }
  }

  return shopFromDest(payload?.dest || "");
}

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
    adSpend: 0,
  };
  map.set(date, row);
  return row;
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cur <= endDate) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const start = (searchParams.get("start") || "").trim();
    const end = (searchParams.get("end") || "").trim();

    if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) {
      return NextResponse.json({ ok: false, error: "Invalid or missing start/end" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1] || "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const shop = await shopFromSessionToken(token);
    if (!shop) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabase = supabaseAdmin();

    const { data: install, error: installErr } = await supabase
      .from("shopify_app_installs")
      .select("client_id")
      .eq("shop_domain", shop)
      .maybeSingle();

    if (installErr || !install?.client_id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const clientId = String(install.client_id);

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

    for (const d of dateRange(start, end)) {
      ensureDate(merged, d);
    }

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
      out.adSpend += spend;
    }

    const rows = Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
