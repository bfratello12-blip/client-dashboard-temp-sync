import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAuth(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
  if (!secret) return;

  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const qp = req.nextUrl.searchParams.get("token")?.trim() || "";

  const ok = bearer === secret || qp === secret || header === secret;
  if (!ok) throw new Error("Unauthorized");
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const url = req.nextUrl;
    const origin = url.origin;
    const clientId = url.searchParams.get("client_id")?.trim() || "";
    const start = url.searchParams.get("start")?.trim() || "";
    const end = url.searchParams.get("end")?.trim() || "";
    const throttleMs = url.searchParams.get("throttleMs")?.trim();

    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json(
        { ok: false, error: "Missing start or end (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
    const tokenParam = secret ? `&token=${encodeURIComponent(secret)}` : "";
    const throttleParam = throttleMs ? `&throttleMs=${encodeURIComponent(throttleMs)}` : "";

    const lineItemsUrl = `${origin}/api/shopify/daily-line-items-sync?client_id=${encodeURIComponent(
      clientId
    )}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${throttleParam}`;
    const rollingUrl = `${origin}/api/cron/rolling-30?client_id=${encodeURIComponent(
      clientId
    )}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${tokenParam}`;

    const authedHeaders = secret ? { authorization: `Bearer ${secret}` } : undefined;

    const lineItemsRes = await fetch(lineItemsUrl, { method: "POST", headers: authedHeaders });
    const lineItemsBody = await safeJson(lineItemsRes);

    const rollingRes = await fetch(rollingUrl, { method: "POST", headers: authedHeaders });
    const rollingBody = await safeJson(rollingRes);

    const errors: any[] = [];
    if (!lineItemsRes.ok) {
      errors.push({ step: "shopify_daily_line_items", status: lineItemsRes.status, body: lineItemsBody });
    }
    if (!rollingRes.ok) {
      errors.push({ step: "rolling30", status: rollingRes.status, body: rollingBody });
    }

    return NextResponse.json({
      ok: errors.length === 0,
      window: { start, end },
      shopify_line_items: lineItemsBody ?? { status: lineItemsRes.status },
      rolling30: rollingBody ?? { status: rollingRes.status },
      errors,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
