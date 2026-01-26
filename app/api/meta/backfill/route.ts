// app/api/meta/backfill/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntegrationRow = {
  client_id: string;
  provider: string;
  status: string | null;
  meta_ad_account_id: string | null;
  meta_access_token: string | null;
};

type BackfillInput = {
  client_id: string;
  since: string;
  until: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function toYMD(input: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`Invalid date format. Use YYYY-MM-DD (got: ${input})`);
  }
  return input;
}

function ymdFromDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysUTC(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return ymdFromDateUTC(d);
}

function isAfter(a: string, b: string): boolean {
  return a > b; // works for YYYY-MM-DD string comparisons
}

async function requireCronAuthIfConfigured(req: NextRequest): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return null;

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function parseBackfillInput(req: NextRequest, body: any | null): BackfillInput {
  const url = new URL(req.url);

  const client_id =
    (body?.client_id as string) ||
    (body?.clientId as string) ||
    url.searchParams.get("client_id") ||
    url.searchParams.get("clientId") ||
    "";

  const sinceRaw =
    (body?.since as string) ||
    (body?.start as string) ||
    (body?.from as string) ||
    url.searchParams.get("since") ||
    url.searchParams.get("start") ||
    url.searchParams.get("from") ||
    "";

  const untilRaw =
    (body?.until as string) ||
    (body?.end as string) ||
    (body?.to as string) ||
    url.searchParams.get("until") ||
    url.searchParams.get("end") ||
    url.searchParams.get("to") ||
    "";

  const daysParam = (body?.days as number | string) ?? url.searchParams.get("days");
  const days = daysParam != null ? Number(daysParam) : NaN;

  if (!client_id) throw new Error("Missing client_id");

  let since: string;
  let until: string;

  if (sinceRaw && untilRaw) {
    since = toYMD(sinceRaw);
    until = toYMD(untilRaw);
  } else if (!Number.isNaN(days) && days > 0) {
    const today = ymdFromDateUTC(new Date());
    until = today;
    since = addDaysUTC(today, -(days - 1));
  } else {
    throw new Error("Missing date range. Provide since+until (YYYY-MM-DD) or days.");
  }

  if (isAfter(since, until)) {
    throw new Error(`Invalid range: since (${since}) is after until (${until})`);
  }

  // Guardrail (serverless friendly)
  const maxDays = Number(process.env.META_BACKFILL_MAX_DAYS || 370);
  const daysRequested =
    Math.floor((Date.parse(until + "T00:00:00Z") - Date.parse(since + "T00:00:00Z")) / 86400000) + 1;

  if (!Number.isFinite(daysRequested) || daysRequested <= 0) throw new Error("Invalid date range");
  if (daysRequested > maxDays) throw new Error(`Range too large (${daysRequested} days). Max ${maxDays}.`);

  return { client_id, since, until };
}

function pickActionValue(actionValues: any[] | null | undefined, keys: string[]): number {
  if (!Array.isArray(actionValues)) return 0;
  for (const k of keys) {
    const hit = actionValues.find((x) => x?.action_type === k);
    if (hit?.value != null) return Number(hit.value) || 0;
  }
  return 0;
}

function pickActionCount(actions: any[] | null | undefined, keys: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const k of keys) {
    const hit = actions.find((x) => x?.action_type === k);
    if (hit?.value != null) return Number(hit.value) || 0;
  }
  return 0;
}

async function fetchMetaDayMetrics(args: {
  day: string;
  adAccountId: string;
  accessToken: string;
}): Promise<{
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
}> {
  const { day, adAccountId, accessToken } = args;

  const apiVersion = process.env.META_API_VERSION || "v21.0";
  const timeRange = { since: day, until: day };

  const fields = ["spend", "impressions", "clicks", "actions", "action_values"].join(",");

  const params = new URLSearchParams();
  params.set("access_token", accessToken);
  params.set("time_range", JSON.stringify(timeRange));
  params.set("level", "account");
  params.set("fields", fields);
  params.set("limit", "1000");

  const metaUrl = `https://graph.facebook.com/${apiVersion}/${adAccountId}/insights?${params.toString()}`;

  const r = await fetch(metaUrl, { method: "GET", cache: "no-store" });
  const raw = await r.text();

  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(
      `Meta API returned non-JSON response (status ${r.status}). First 120 chars: ${raw.slice(0, 120)}`
    );
  }

  if (!r.ok) {
    const msg = json?.error?.message || "Meta API error";
    throw new Error(`${msg} (status ${r.status})`);
  }

  const row = Array.isArray(json?.data) ? json.data[0] : null;

  const spend = Number(row?.spend ?? 0) || 0;
  const impressions = Number(row?.impressions ?? 0) || 0;
  const clicks = Number(row?.clicks ?? 0) || 0;

  const purchases = pickActionCount(row?.actions, [
    "purchase",
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "offsite_conversion.fb_pixel_purchase_value", // sometimes shows up oddly
    "offsite_conversion.purchase",
    "web_in_store_purchase",
  ]);

  const revenue = pickActionValue(row?.action_values, [
    "purchase",
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "offsite_conversion.purchase",
    "web_in_store_purchase",
  ]);

  return { spend, impressions, clicks, purchases, revenue };
}

/**
 * Your daily_metrics schema differs across installs.
 * This upsert will automatically drop fields that don't exist in the table,
 * based on Supabase/PostgREST error messages, and retry.
 */
async function upsertDailyMetricsResilient(
  supabase: any,
  basePayload: Record<string, any>
): Promise<{ removed: string[] }> {
  let payload: Record<string, any> = { ...basePayload };
  const removed: string[] = [];

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await supabase
      .from("daily_metrics")
      .upsert(payload, { onConflict: "date,client_id,source" });

    if (!error) return { removed };

    const msg = String(error?.message || "");

    // Example: Could not find the 'purchases' column of 'daily_metrics' in the schema cache
    const m = msg.match(/Could not find the '([^']+)' column of 'daily_metrics'/i);
    if (m?.[1]) {
      const col = m[1];
      if (col in payload) {
        delete payload[col];
        removed.push(col);
        continue; // retry
      }
    }

    // Not a missing-column error — bubble it
    throw new Error(msg || "Upsert failed");
  }

  throw new Error("Failed to upsert daily_metrics after retries.");
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const authFail = await requireCronAuthIfConfigured(req);
  if (authFail) return authFail;

  const body = req.method === "POST" ? await req.json().catch(() => null) : null;
  const { client_id, since, until } = parseBackfillInput(req, body);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRole = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const { data: integ, error: integErr } = await supabase
    .from("client_integrations")
    .select("client_id, provider, status, meta_ad_account_id, meta_access_token")
    .eq("client_id", client_id)
    .eq("provider", "meta")
    .maybeSingle<IntegrationRow>();

  if (integErr) {
    return NextResponse.json({ ok: false, error: integErr.message }, { status: 500 });
  }

  if (!integ?.meta_ad_account_id || !integ?.meta_access_token) {
    return NextResponse.json(
      { ok: false, error: "Meta integration not connected for this client." },
      { status: 400 }
    );
  }

  const adAccountId = integ.meta_ad_account_id;
  const accessToken = integ.meta_access_token;

  const results: Array<{ day: string; ok: boolean; error?: string }> = [];
  let okDays = 0;

  for (let day = since; !isAfter(day, until); day = addDaysUTC(day, 1)) {
    try {
      const { spend, impressions, clicks, purchases, revenue } = await fetchMetaDayMetrics({
        day,
        adAccountId,
        accessToken,
      });

      const payload: Record<string, any> = {
        date: day,
        client_id,
        source: "meta",
        spend,
        revenue,

        // optional fields — kept if your schema supports them
        impressions: Math.trunc(impressions),
        clicks: Math.trunc(clicks),
        purchases: Math.trunc(purchases),
        conversions: Math.trunc(purchases),
        orders: Math.trunc(purchases),
      };

      await upsertDailyMetricsResilient(supabase, payload);

      okDays += 1;
      results.push({ day, ok: true });
    } catch (e: any) {
      results.push({ day, ok: false, error: e?.message ?? "Unknown error" });
    }
  }

  return NextResponse.json({
    ok: true,
    client_id,
    since,
    until,
    okDays,
    totalDays: results.length,
    results,
  });
}

export async function GET(req: NextRequest) {
  try {
    return await handler(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handler(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
