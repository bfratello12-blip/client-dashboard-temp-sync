import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cronAuth";
import { runUnifiedSync } from "@/lib/sync/unifiedSync";
import { resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = requireCronAuth(req);
    if (auth) return auth;

    const url = req.nextUrl;
    const origin = url.origin;
    const shopDomain = url.searchParams.get("shop_domain")?.trim() || "";
    const clientIdParam = shopDomain ? await resolveClientIdFromShopDomainParam(shopDomain) || "" : "";
    const fallbackClientId = process.env.DEFAULT_CLIENT_ID || "";
    const clientId = clientIdParam || fallbackClientId;
    if (!clientId) {
      return NextResponse.json(
        { ok: false, error: "shop_domain required (or set DEFAULT_CLIENT_ID)" },
        { status: 400 }
      );
    }

    const providedStart = url.searchParams.get("start")?.trim() || undefined;
    const providedEnd = url.searchParams.get("end")?.trim() || undefined;
    const secret = String(process.env.CRON_SECRET || "").trim();

    const result = await runUnifiedSync({
      origin,
      clientId,
      start: providedStart,
      end: providedEnd,
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
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
