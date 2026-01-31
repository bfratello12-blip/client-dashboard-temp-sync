import { NextRequest, NextResponse } from "next/server";
import { isoDateUTC } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireCronAuth(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
  if (!secret) return; // allow if not configured

  const qp = req.nextUrl.searchParams.get("token")?.trim() || "";
  if (!qp || qp !== secret) {
    throw new Error("Unauthorized");
  }
}

type StepSummary = {
  step: string;
  ok: boolean;
  status: number;
  daysWritten?: number;
  rowsWritten?: number;
  error?: string;
};

function buildWindow(start?: string, end?: string) {
  if (start && end) return { start, end };
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  endDate.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  return { start: isoDateUTC(startDate), end: isoDateUTC(endDate) };
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function pickCounts(body: any) {
  const daysWritten = Number(body?.daysWritten);
  if (Number.isFinite(daysWritten)) return { daysWritten };
  const rowsWritten = Number(body?.rowsWritten);
  if (Number.isFinite(rowsWritten)) return { rowsWritten };
  return {};
}

async function runStep(args: {
  step: string;
  url: string;
  headers?: Record<string, string>;
}) {
  const res = await fetch(args.url, {
    method: "POST",
    headers: args.headers,
  });
  const body = await safeJson(res);
  const ok = res.ok && (body?.ok !== false);
  const summary: StepSummary = {
    step: args.step,
    ok,
    status: res.status,
    ...pickCounts(body),
  };
  if (!ok) {
    summary.error = body?.error || body?.message || `HTTP ${res.status}`;
  }
  return { res, body, summary };
}

export async function GET(req: NextRequest) {
  try {
    requireCronAuth(req);

    const url = req.nextUrl;
    const origin = url.origin;
    const clientId = url.searchParams.get("client_id")?.trim() || "";
    if (!clientId) {
      return NextResponse.json({ ok: false, error: "client_id required" }, { status: 400 });
    }

    const providedStart = url.searchParams.get("start")?.trim() || "";
    const providedEnd = url.searchParams.get("end")?.trim() || "";
    const window = buildWindow(providedStart || undefined, providedEnd || undefined);

    const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_SYNC_TOKEN || "";
    const authHeader = secret ? { Authorization: `Bearer ${secret}` } : undefined;

    const steps: StepSummary[] = [];

    const shopifyParams = new URLSearchParams({
      client_id: clientId,
      start: window.start,
      end: window.end,
      force: "1",
    });
    const shopifyUrl = `${origin}/api/shopify/sync?${shopifyParams.toString()}`;
    const shopify = await runStep({ step: "shopify_sync", url: shopifyUrl });
    steps.push(shopify.summary);
    if (!shopify.summary.ok) {
      return NextResponse.json({ ok: false, steps }, { status: shopify.summary.status || 500 });
    }

    const googleParams = new URLSearchParams({
      client_id: clientId,
      start: window.start,
      end: window.end,
      fillZeros: "1",
    });
    const googleUrl = `${origin}/api/googleads/sync?${googleParams.toString()}`;
    const google = await runStep({ step: "googleads_sync", url: googleUrl, headers: authHeader });
    steps.push(google.summary);
    if (!google.summary.ok) {
      return NextResponse.json({ ok: false, steps }, { status: google.summary.status || 500 });
    }

    const metaParams = new URLSearchParams({
      client_id: clientId,
      start: window.start,
      end: window.end,
      fillZeros: "1",
    });
    const metaUrl = `${origin}/api/meta/sync?${metaParams.toString()}`;
    const meta = await runStep({ step: "meta_sync", url: metaUrl, headers: authHeader });
    steps.push(meta.summary);
    if (!meta.summary.ok) {
      return NextResponse.json({ ok: false, steps }, { status: meta.summary.status || 500 });
    }

    const lineItemsParams = new URLSearchParams({
      client_id: clientId,
      start: window.start,
      end: window.end,
    });
    const lineItemsUrl = `${origin}/api/shopify/daily-line-items-sync?${lineItemsParams.toString()}`;
    const lineItems = await runStep({
      step: "shopify_daily_line_items",
      url: lineItemsUrl,
      headers: authHeader,
    });
    steps.push(lineItems.summary);
    if (!lineItems.summary.ok) {
      return NextResponse.json({ ok: false, steps }, { status: lineItems.summary.status || 500 });
    }

    const recomputeParams = new URLSearchParams({
      token: secret,
      start: window.start,
      end: window.end,
    });
    const recomputeUrl = `${origin}/api/shopify/recompute?${recomputeParams.toString()}`;
    const recompute = await runStep({ step: "shopify_recompute", url: recomputeUrl });
    steps.push(recompute.summary);
    if (!recompute.summary.ok) {
      return NextResponse.json({ ok: false, steps }, { status: recompute.summary.status || 500 });
    }

    const rollingParams = new URLSearchParams({
      client_id: clientId,
      start: window.start,
      end: window.end,
      token: secret,
    });
    const rollingUrl = `${origin}/api/cron/rolling-30?${rollingParams.toString()}`;
    const rolling = await runStep({ step: "rolling_30", url: rollingUrl });
    steps.push(rolling.summary);
    if (!rolling.summary.ok) {
      return NextResponse.json({ ok: false, steps }, { status: rolling.summary.status || 500 });
    }

    return NextResponse.json({ ok: true, steps });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
