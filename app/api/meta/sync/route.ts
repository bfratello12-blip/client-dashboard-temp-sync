// app/api/meta/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCronAuth } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntegrationRow = {
  client_id: string;
  provider: string;
  status: string | null;
  meta_ad_account_id: string | null; // e.g. "act_123..."
  meta_access_token: string | null;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseWindow(req: NextRequest, body: any | null) {
  const sp = req.nextUrl.searchParams;
  const start = (body?.start ?? body?.since ?? sp.get("start") ?? sp.get("since") ?? "").toString().trim();
  const end = (body?.end ?? body?.until ?? sp.get("end") ?? sp.get("until") ?? "").toString().trim();
  const fillZerosRaw = (body?.fillZeros ?? sp.get("fillZeros") ?? "0").toString();
  const fillZeros = fillZerosRaw === "1" || fillZerosRaw.toLowerCase() === "true";
  const client_id = (body?.client_id ?? sp.get("client_id") ?? "").toString().trim() || undefined;

  // default: last 30 days ending yesterday (UTC)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const endISO = end || ymd(yesterday);
  const startDefault = new Date(`${endISO}T00:00:00.000Z`);
  startDefault.setUTCDate(startDefault.getUTCDate() - 29);
  const startISO = start || ymd(startDefault);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(endISO)) {
    throw new Error(`Invalid start/end. Expected YYYY-MM-DD. Got start=${startISO} end=${endISO}`);
  }

  return { startISO, endISO, fillZeros, client_id };
}

function dateRangeInclusive(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${startISO}T00:00:00.000Z`);
  const end = new Date(`${endISO}T00:00:00.000Z`);
  while (d <= end) {
    out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function pickActionCount(actions: any[] | null | undefined, keys: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const k of keys) {
    const hit = actions.find((x) => x?.action_type === k);
    if (hit?.value != null) return Number(hit.value) || 0;
  }
  return 0;
}

function pickActionValue(values: any[] | null | undefined, keys: string[]): number {
  if (!Array.isArray(values)) return 0;
  for (const k of keys) {
    const hit = values.find((x) => x?.action_type === k);
    if (hit?.value != null) return Number(hit.value) || 0;
  }
  return 0;
}

// NOTE: We keep this "resilient" upsert to tolerate schema differences across environments.
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

    // Supabase schema cache message:
    // "Could not find the 'purchases' column of 'daily_metrics' in the schema cache"
    const m =
      msg.match(/Could not find the '([^']+)' column of 'daily_metrics'/i) ||
      msg.match(/column ["']?([\w_]+)["']? of relation ['"]?daily_metrics/i);

    if (m?.[1]) {
      const col = m[1];
      if (col in payload) {
        delete payload[col];
        removed.push(col);
        continue;
      }
    }

    throw new Error(msg || "Upsert failed");
  }

  throw new Error("Failed to upsert daily_metrics after retries.");
}

async function fetchMetaInsightsDailyRange(args: {
  adAccountId: string;
  accessToken: string;
  startISO: string;
  endISO: string;
}) {
  const apiVersion = process.env.META_API_VERSION || "v21.0";

  const fields = [
    "date_start",
    "spend",
    "impressions",
    "clicks",
    "actions",
    "action_values",
  ].join(",");

  const timeRange = { since: args.startISO, until: args.endISO };

  const params = new URLSearchParams();
  params.set("access_token", args.accessToken);
  params.set("time_range", JSON.stringify(timeRange));
  params.set("time_increment", "1");
  params.set("level", "account");
  params.set("fields", fields);
  params.set("limit", "1000");

  let url = `https://graph.facebook.com/${apiVersion}/${args.adAccountId}/insights?${params.toString()}`;

  const out: Array<{
    day: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    revenue: number;
  }> = [];

  while (url) {
    const r = await fetch(url, { method: "GET", cache: "no-store" });
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

    const rows = Array.isArray(json?.data) ? json.data : [];

    for (const row of rows) {
      const day = String(row?.date_start || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

      const spend = Number(row?.spend ?? 0) || 0;
      const impressions = Number(row?.impressions ?? 0) || 0;
      const clicks = Number(row?.clicks ?? 0) || 0;

      const purchases = pickActionCount(row?.actions, [
        "purchase",
        "omni_purchase",
        "offsite_conversion.fb_pixel_purchase",
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

      out.push({ day, spend, impressions, clicks, purchases, revenue });
    }

    url = json?.paging?.next || "";
  }

  return out;
}

async function gapFillZerosIfMissing(args: {
  supabase: any;
  clientId: string;
  source: string;
  startISO: string;
  endISO: string;
}) {
  const days = dateRangeInclusive(args.startISO, args.endISO);
  if (!days.length) return { inserted: 0 };

  const { data, error } = await args.supabase
    .from("daily_metrics")
    .select("date")
    .eq("client_id", args.clientId)
    .eq("source", args.source)
    .gte("date", args.startISO)
    .lte("date", args.endISO);

  if (error) throw new Error(`daily_metrics select failed: ${error.message}`);

  const existing = new Set((data ?? []).map((r: any) => r.date));
  const missing = days.filter((d) => !existing.has(d));
  if (!missing.length) return { inserted: 0 };

  const zeroRows = missing.map((d) => ({
    client_id: args.clientId,
    source: args.source,
    date: d,
    spend: 0,
    revenue: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    orders: 0,
  }));

  // IMPORTANT: ignoreDuplicates ensures we never overwrite a real day with zeros.
  const ins = await args.supabase
    .from("daily_metrics")
    .upsert(zeroRows, { onConflict: "date,client_id,source", ignoreDuplicates: true });

  if (ins.error) throw new Error(`daily_metrics gap-fill failed: ${ins.error.message}`);
  return { inserted: missing.length };
}

async function handler(req: NextRequest) {
  const auth = requireCronAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = req.method === "POST" ? await req.json().catch(() => null) : null;
  const { startISO, endISO, fillZeros, client_id } = parseWindow(req, body);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error("SUPABASE_URL is required.");
  if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  let q = supabase
    .from("client_integrations")
    .select("client_id, provider, status, meta_ad_account_id, meta_access_token")
    .eq("provider", "meta");

  if (client_id) q = q.eq("client_id", client_id);

  const { data: integrations, error: integErr } = await q;
  if (integErr) return NextResponse.json({ ok: false, error: integErr.message }, { status: 500 });

  const active = (integrations ?? []).filter(
    (i: any) => i?.meta_ad_account_id && i?.meta_access_token
  ) as IntegrationRow[];

  const results: any[] = [];
  const errors: any[] = [];
  let daysWritten = 0;
  let zerosInserted = 0;

  for (const integ of active) {
    const clientId = integ.client_id;
    try {
      const daily = await fetchMetaInsightsDailyRange({
        adAccountId: integ.meta_ad_account_id!,
        accessToken: integ.meta_access_token!,
        startISO,
        endISO,
      });

      const byDay = new Map<string, typeof daily[number]>();
      for (const r of daily) byDay.set(r.day, r);

      for (const [day, r] of byDay.entries()) {
        // IMPORTANT: do NOT write "purchases" column (it doesn't exist in your daily_metrics schema).
        const payload: Record<string, any> = {
          date: day,
          client_id: clientId,
          source: "meta",

          spend: Number(r.spend || 0),
          revenue: Number(r.revenue || 0),

          impressions: Math.trunc(Number(r.impressions || 0)),
          clicks: Math.trunc(Number(r.clicks || 0)),

          conversions: Math.trunc(Number(r.purchases || 0)),
          orders: Math.trunc(Number(r.purchases || 0)),
        };

        await upsertDailyMetricsResilient(supabase, payload);
        daysWritten += 1;
      }

      if (fillZeros) {
        const gf = await gapFillZerosIfMissing({
          supabase,
          clientId,
          source: "meta",
          startISO,
          endISO,
        });
        zerosInserted += gf.inserted;
      }

      results.push({ client_id: clientId, status: "ok", daysReturned: byDay.size });
    } catch (e: any) {
      errors.push({ client_id: clientId, error: e?.message || String(e) });
      results.push({ client_id: clientId, status: "error" });
    }
  }

  return NextResponse.json({
    ok: true,
    source: "meta",
    start: startISO,
    end: endISO,
    fillZeros,
    clients: active.length,
    daysWritten,
    zerosInserted,
    errors,
    results,
  });
}

export async function GET(req: NextRequest) {
  try {
    return await handler(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handler(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
