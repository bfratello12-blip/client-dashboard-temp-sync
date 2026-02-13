// app/api/sync/manual-refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runUnifiedSync } from "@/lib/sync/unifiedSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readParam(req: NextRequest, body: any, key: string) {
  return (body?.[key] ?? req.nextUrl.searchParams.get(key) ?? "").toString().trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const clientId = readParam(req, body, "client_id");
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "Missing client_id" }, { status: 400 });
    }

    const start = readParam(req, body, "start") || undefined;
    const end = readParam(req, body, "end") || undefined;

    const secret = String(process.env.CRON_SECRET || "").trim();

    const result = await runUnifiedSync({
      origin: req.nextUrl.origin,
      clientId,
      start,
      end,
      token: secret,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, client_id: clientId, steps: result.steps },
        { status: result.status || 500 }
      );
    }

    return NextResponse.json({ ok: true, client_id: clientId, steps: result.steps });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
