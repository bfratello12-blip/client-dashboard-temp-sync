import { NextRequest, NextResponse } from "next/server";
import { isoDateUTC } from "@/lib/dates";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireCronAuth(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
  if (!secret) return; // allow if not configured

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
    requireCronAuth(req);

    const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
    const url = req.nextUrl;
    const origin = url.origin;
    const clientId = url.searchParams.get("client_id")?.trim() || "";

    const endDate = new Date();
    const endISO = isoDateUTC(endDate);
    const startISO = isoDateUTC(new Date(endDate.getTime() - 7 * 24 * 3600 * 1000));

    const baseParams = new URLSearchParams();
    baseParams.set("start", startISO);
    baseParams.set("end", endISO);
    if (clientId) baseParams.set("client_id", clientId);

    const tokenParams = new URLSearchParams(baseParams);
    if (secret) tokenParams.set("token", secret);

    const shopifyUrl = `${origin}/api/shopify/sync?${tokenParams.toString()}`;
    const lineItemsUrl = `${origin}/api/shopify/daily-line-items-sync?${baseParams.toString()}`;
    const rollingUrl = `${origin}/api/cron/rolling-30?${tokenParams.toString()}`;

    const authedHeaders = secret ? { authorization: `Bearer ${secret}` } : undefined;
    const googleUrl = `${origin}/api/googleads/sync?${baseParams.toString()}`;
    const metaUrl = `${origin}/api/meta/sync?${baseParams.toString()}`;

    const shopifyRes = await fetch(shopifyUrl, { method: "POST" });
    const shopifyBody = await safeJson(shopifyRes);

    let lineItemsBody: any = null;
    let lineItemsRes: Response | null = null;
    if (clientId) {
      lineItemsRes = await fetch(lineItemsUrl, { method: "POST", headers: authedHeaders });
      lineItemsBody = await safeJson(lineItemsRes);
    } else {
      const supabase = supabaseAdmin();
      const { data: integrations, error: integErr } = await supabase
        .from("client_integrations")
        .select("client_id")
        .eq("provider", "shopify")
        .eq("is_active", true)
        .limit(5000);
      if (integErr) throw integErr;

      const lineItemErrors: any[] = [];
      for (const row of integrations || []) {
        const cid = String((row as any).client_id || "");
        if (!cid) continue;
        const perClientParams = new URLSearchParams(baseParams);
        perClientParams.set("client_id", cid);
        const perClientUrl = `${origin}/api/shopify/daily-line-items-sync?${perClientParams.toString()}`;
        const res = await fetch(perClientUrl, { method: "POST", headers: authedHeaders });
        const body = await safeJson(res);
        if (!res.ok) lineItemErrors.push({ client_id: cid, status: res.status, body });
      }

      lineItemsBody = {
        ok: lineItemErrors.length === 0,
        errors: lineItemErrors,
      };
    }

    const googleRes = await fetch(googleUrl, {
      method: "POST",
      headers: authedHeaders,
    });
    const googleBody = await safeJson(googleRes);

    const metaRes = await fetch(metaUrl, {
      method: "POST",
      headers: authedHeaders,
    });
    const metaBody = await safeJson(metaRes);

    const rollingRes = await fetch(rollingUrl, { method: "POST" });
    const rollingBody = await safeJson(rollingRes);

    const errors: any[] = [];
    if (!shopifyRes.ok) errors.push({ step: "shopify", status: shopifyRes.status, body: shopifyBody });
    if (lineItemsRes && !lineItemsRes.ok)
      errors.push({ step: "shopify_daily_line_items", status: lineItemsRes.status, body: lineItemsBody });
    if (!lineItemsRes && lineItemsBody?.errors?.length)
      errors.push({ step: "shopify_daily_line_items", status: 500, body: lineItemsBody });
    if (!googleRes.ok) errors.push({ step: "google", status: googleRes.status, body: googleBody });
    if (!metaRes.ok) errors.push({ step: "meta", status: metaRes.status, body: metaBody });
    if (!rollingRes.ok) errors.push({ step: "rolling30", status: rollingRes.status, body: rollingBody });

    return NextResponse.json({
      ok: errors.length === 0,
      window: { start: startISO, end: endISO },
      shopify: shopifyBody ?? { status: shopifyRes.status },
      shopify_line_items: lineItemsBody ?? { status: lineItemsRes?.status },
      google: googleBody ?? { status: googleRes.status },
      meta: metaBody ?? { status: metaRes.status },
      rolling30: rollingBody ?? { status: rollingRes.status },
      errors,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
