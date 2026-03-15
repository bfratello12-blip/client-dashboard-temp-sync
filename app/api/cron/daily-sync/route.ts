import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cronAuth";
import { runUnifiedSync } from "@/lib/sync/unifiedSync";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = requireCronAuth(req);
    if (auth) return auth;

    const url = req.nextUrl;
    const origin = url.origin;
    const providedStart = url.searchParams.get("start")?.trim() || undefined;
    const providedEnd = url.searchParams.get("end")?.trim() || undefined;
    const secret = String(process.env.CRON_SECRET || "").trim();
    const supabase = supabaseAdmin();

    const { data: installs, error: installsErr } = await supabase
      .from("shopify_app_installs")
      .select("shop_domain");

    if (installsErr) {
      return NextResponse.json({ ok: false, error: installsErr.message }, { status: 500 });
    }

    const shopDomains = Array.from(
      new Set(
        (installs || [])
          .map((r: any) => String(r?.shop_domain || "").trim().toLowerCase())
          .filter(Boolean)
      )
    );

    const results: Array<{ shop_domain: string; ok: boolean; client_id?: string; steps?: any; error?: string }> = [];
    const failures: Array<{ shop_domain: string; client_id?: string; status?: number; error?: string; steps?: any }> = [];

    for (const shopDomain of shopDomains) {
      const result = await runUnifiedSync({
        origin,
        shopDomain,
        start: providedStart,
        end: providedEnd,
        token: secret,
      });

      if (!result.ok) {
        const failure = {
          shop_domain: shopDomain,
          client_id: result.client_id,
          status: result.status || 500,
          error: result.steps?.find((s: any) => !s.ok)?.error || "Sync failed",
          steps: result.steps,
        };
        failures.push(failure);
        results.push({ shop_domain: shopDomain, ok: false, client_id: result.client_id, error: failure.error });
        continue;
      }

      results.push({
        shop_domain: shopDomain,
        ok: true,
        client_id: result.client_id,
        steps: result.steps,
      });
    }

    return NextResponse.json({
      ok: failures.length === 0,
      processed: shopDomains.length,
      succeeded: shopDomains.length - failures.length,
      failed: failures.length,
      results,
      failures,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
