import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getBearerToken, isRequestAuthorizedForClient, resolveClientIdFromShopDomainParam } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const expectedCronSecret = String(process.env.CRON_SECRET || "").trim();
    const bearer = getBearerToken(req);
    const qpToken = req.nextUrl.searchParams.get("token")?.trim() || "";
    const cronAuthorized =
      Boolean(expectedCronSecret) && (bearer === expectedCronSecret || qpToken === expectedCronSecret);

    const url = req.nextUrl;
    const shopDomain = url.searchParams.get("shop_domain")?.trim() || "";
    const clientIdParam = url.searchParams.get("client_id")?.trim() || "";
    const start = url.searchParams.get("start")?.trim() || "";
    const end = url.searchParams.get("end")?.trim() || "";

    if (!shopDomain && !clientIdParam) {
      return NextResponse.json({ ok: false, error: "Missing shop_domain or client_id" }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json({ ok: false, error: "Missing start/end (YYYY-MM-DD)" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ ok: false, error: "Invalid start/end (YYYY-MM-DD)" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    let clientId = "";
    if (shopDomain) {
      const resolvedClientId = await resolveClientIdFromShopDomainParam(shopDomain);
      if (!resolvedClientId) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      clientId = resolvedClientId;
    } else {
      clientId = clientIdParam;
      if (!cronAuthorized) {
        const allowed = await isRequestAuthorizedForClient(req, clientId);
        if (!allowed) {
          return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
      }
    }

    const { data, error } = await supabase
      .from("daily_metrics")
      .select("date, client_id, source, spend, revenue, units, clicks, impressions, conversions, orders")
      .eq("client_id", clientId)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
