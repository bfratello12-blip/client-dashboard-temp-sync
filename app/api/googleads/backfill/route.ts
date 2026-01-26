// app/api/googleads/backfill/route.ts
import { NextRequest, NextResponse } from "next/server";

function parseYMD(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get("client_id") || "";
    const start = url.searchParams.get("start") || "";
    const end = url.searchParams.get("end") || "";

    const expected = process.env.CRON_SECRET?.trim();
    if (expected) {
      const auth = req.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (token !== expected) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    if (!clientId) return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    if (!start || !end) return NextResponse.json({ ok: false, error: "Missing start/end" }, { status: 400 });

    const startDate = parseYMD(start);
    const endDate = parseYMD(end);
    const days = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    if (days < 1) return NextResponse.json({ ok: false, error: "Bad range" }, { status: 400 });

    if (days > 1200) {
      return NextResponse.json({ ok: false, error: `Range too large (${days} days).` }, { status: 400 });
    }

    const origin = `${url.protocol}//${url.host}`;
    let okCount = 0;
    let failCount = 0;
    const failures: any[] = [];

    for (let i = 0; i < days; i++) {
      const day = toYMD(addDays(startDate, i));
      const endpoint = `${origin}/api/googleads/sync?client_id=${encodeURIComponent(clientId)}&day=${day}&fillZeros=1`;

      const r = await fetch(endpoint, {
        headers: expected ? { Authorization: `Bearer ${expected}` } : {},
        cache: "no-store",
      });

      let j: any = null;
      try {
        j = await r.json();
      } catch {
        j = { ok: false, error: "Non-JSON response" };
      }

      if (r.ok && j?.ok) okCount++;
      else {
        failCount++;
        if (failures.length < 25) failures.push({ day, status: r.status, error: j?.error, details: j?.details });
      }
    }

    return NextResponse.json({ ok: true, client_id: clientId, start, end, days, okCount, failCount, failures });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

