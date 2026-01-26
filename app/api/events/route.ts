// app/api/events/route.ts
//
// Server-side Events API for the dashboard.
// - Uses Supabase Service Role (via getSupabaseAdmin) so it can read/write regardless of RLS.
// - Table expected: "events" with columns:
//   id, client_id, event_date, type, title, notes, impact_window_days, created_at
//
// GET    /api/events?client_id=...&start=YYYY-MM-DD&end=YYYY-MM-DD
// POST   /api/events   { client_id, event_date, type, title, notes?, impact_window_days? }
// DELETE /api/events?id=...&client_id=...

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED_TYPES = ["budget_change", "promo", "price_change", "site_change", "feed_change", "other"] as const;
type EventType = (typeof ALLOWED_TYPES)[number];

function isISODate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function normalizeType(t: any): EventType {
  const v = String(t || "").trim();
  return (ALLOWED_TYPES as readonly string[]).includes(v) ? (v as EventType) : "other";
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const client_id = (searchParams.get("client_id") || "").trim();
    if (!client_id) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const start = (searchParams.get("start") || "").trim();
    const end = (searchParams.get("end") || "").trim();

    // Default window: last 180 days to cover typical chart ranges
    const now = new Date();
    const endISO = isISODate(end) ? end : now.toISOString().slice(0, 10);
    const startISO = isISODate(start)
      ? start
      : new Date(now.getTime() - 179 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    if (!isISODate(startISO) || !isISODate(endISO)) {
      return NextResponse.json({ ok: false, error: "Invalid start/end (YYYY-MM-DD)" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("events")
      .select("id, client_id, event_date, type, title, notes, impact_window_days, created_at")
      .eq("client_id", client_id)
      .gte("event_date", startISO)
      .lte("event_date", endISO)
      .order("event_date", { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      client_id,
      start: startISO,
      end: endISO,
      events: data || [],
      allowed_types: ALLOWED_TYPES,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => ({} as any));

    const client_id = String(body?.client_id || "").trim();
    const event_date = String(body?.event_date || "").trim();
    const title = String(body?.title || "").trim();
    const notes = typeof body?.notes === "string" ? body.notes.trim() : null;

    if (!client_id) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    if (!isISODate(event_date)) return NextResponse.json({ ok: false, error: "Invalid event_date (YYYY-MM-DD)" }, { status: 400 });
    if (!title) return NextResponse.json({ ok: false, error: "Missing title" }, { status: 400 });

    const type = normalizeType(body?.type);
    const impact_window_days = clampInt(body?.impact_window_days, 1, 90, 7);

    const { data, error } = await supabase
      .from("events")
      .insert({
        client_id,
        event_date,
        type,
        title,
        notes,
        impact_window_days,
      })
      .select("id, client_id, event_date, type, title, notes, impact_window_days, created_at")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, event: data, allowed_types: ALLOWED_TYPES });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const id = (searchParams.get("id") || "").trim();
    const client_id = (searchParams.get("client_id") || "").trim();

    if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
    if (!client_id) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });

    const { error } = await supabase.from("events").delete().eq("id", id).eq("client_id", client_id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

