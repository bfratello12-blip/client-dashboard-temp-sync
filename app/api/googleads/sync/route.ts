// app/api/googleads/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isoDateUTC, dateRangeInclusiveUTC } from "@/lib/dates";
import { ensureDailyMetricsRows, upsertDailyMetrics, type DailyMetricsRow } from "@/lib/dailyMetrics";
import { requireCronAuth } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GoogleCfg = {
  customerId: string;
  managerCustomerId?: string;
  developerToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
};

function normalizeCustomerId(v: string) {
  return String(v || "").replace(/-/g, "").trim();
}

function parseWindow(req: NextRequest) {
  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const fillZeros = url.searchParams.get("fillZeros") === "1";

  // default: yesterday only
  const endDay = end ? isoDateUTC(new Date(end)) : isoDateUTC(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const startDay = start ? isoDateUTC(new Date(start)) : endDay;

  return { startDay, endDay, fillZeros };
}

async function refreshGoogleAccessToken(cfg: GoogleCfg) {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams();
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("refresh_token", cfg.refreshToken);
  body.set("grant_type", "refresh_token");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${JSON.stringify(json).slice(0, 500)}`);
  }
  const accessToken = String(json?.access_token || "");
  if (!accessToken) throw new Error("Google OAuth token refresh failed: missing access_token");
  return accessToken;
}

/**
 * Google Ads searchStream sometimes comes back as:
 *  - A single JSON array
 *  - A single JSON object
 *  - NDJSON (one JSON object per line)
 *
 * This parser handles all 3. If the payload looks like JSON but we parse 0 objects,
 * we throw to avoid accidentally overwriting non-zero rows with zeros.
 */
function parseGoogleAdsSearchStreamBody(bodyText: string): any[] {
  const txt = String(bodyText ?? "").trim();
  if (!txt) return [];

  // 1) Try parsing the entire response as a single JSON value (array or object)
  try {
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    // fall through to NDJSON parsing
  }

  // 2) Fallback: NDJSON (one JSON object per line)
  const lines = txt
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const out: any[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore line-level parse failures
    }
  }

  // If the payload *looks* like JSON but we couldn't parse anything, fail fast
  // so we don't accidentally overwrite existing non-zero rows with zeros.
  if (out.length === 0 && (txt.startsWith("{") || txt.startsWith("["))) {
    throw new Error(`Google Ads searchStream parse produced 0 objects (body starts): ${txt.slice(0, 200)}`);
  }

  return out;
}

async function fetchGoogleDailyMetrics(cfg: GoogleCfg, startDay: string, endDay: string) {
  const accessToken = await refreshGoogleAccessToken(cfg);

  const gaql = `
    SELECT
      segments.date,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${startDay}' AND '${endDay}'
  `.trim();

  const customer = encodeURIComponent(normalizeCustomerId(cfg.customerId));
  const url = "https://googleads.googleapis.com/v22/customers/" + customer + "/googleAds:searchStream";

  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "developer-token": cfg.developerToken,
    "content-type": "application/json",
  };
  if (cfg.managerCustomerId) headers["login-customer-id"] = normalizeCustomerId(cfg.managerCustomerId);

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query: gaql }) });
  const bodyText = await res.text();

  // IMPORTANT: check errors before attempting to parse
  if (!res.ok) throw new Error(`Google Ads API failed (${res.status}): ${bodyText.slice(0, 500)}`);

  const json = parseGoogleAdsSearchStreamBody(bodyText);

  const byDay = new Map<
    string,
    { clicks: number; impressions: number; spend: number; conversions: number; conversion_value: number }
  >();

  const streams = Array.isArray(json) ? json : [];
  for (const s of streams) {
    for (const r of s.results ?? []) {
      const day = r.segments?.date;
      if (!day) continue;

      const clicks = Number(r.metrics?.clicks ?? 0);
      const impressions = Number(r.metrics?.impressions ?? 0);

      const micros = Number(r.metrics?.costMicros ?? r.metrics?.cost_micros ?? 0);
      const spend = micros / 1_000_000;

      const conversions = Number(r.metrics?.conversions ?? 0);

      // conversions_value comes back as conversionsValue or conversions_value depending on client
      const conversionValue = Number(
        r.metrics?.conversionsValue ??
          r.metrics?.conversions_value ??
          0
      );

      const cur =
        byDay.get(day) ?? { clicks: 0, impressions: 0, spend: 0, conversions: 0, conversion_value: 0 };

      cur.clicks += Number.isFinite(clicks) ? clicks : 0;
      cur.impressions += Number.isFinite(impressions) ? impressions : 0;
      cur.spend += Number.isFinite(spend) ? spend : 0;
      cur.conversions += Number.isFinite(conversions) ? conversions : 0;
      cur.conversion_value += Number.isFinite(conversionValue) ? conversionValue : 0;

      byDay.set(day, cur);
    }
  }

  return byDay;
}

export async function GET(req: NextRequest) {
  const auth = requireCronAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { startDay, endDay, fillZeros } = parseWindow(req);
  const clientIdFilter = req.nextUrl.searchParams.get("client_id")?.trim() ?? null;
  const days = dateRangeInclusiveUTC(startDay, endDay);

  const supabase = getSupabaseAdmin();

  const providerVariants = ["google", "google_ads", "googleads", "google-ads"];
  let q = supabase
    .from("client_integrations")
    .select("client_id, provider, google_ads_customer_id, google_refresh_token")
    .in("provider", providerVariants);

  if (clientIdFilter) q = q.eq("client_id", clientIdFilter);

  const { data: integrations, error: intErr } = await q;
  if (intErr) return NextResponse.json({ ok: false, error: intErr.message }, { status: 500 });

  if (clientIdFilter) {
    const row = integrations?.[0] as any;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "No integration found for client_id" },
        { status: 404 }
      );
    }

    const token = String(row.google_refresh_token ?? "").trim();
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Google Ads not connected for this client" },
        { status: 400 }
      );
    }

    const customerId = String(row.google_ads_customer_id ?? "").trim();
    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "Google Ads account not selected for this client" },
        { status: 400 }
      );
    }
  }

  let daysWritten = 0;
  const errors: any[] = [];
  const results: any[] = [];

  for (const i of integrations ?? []) {
    const clientId = i.client_id as string;

    try {
      const customerId = String(i.google_ads_customer_id ?? "").trim();
      const refreshToken = String(i.google_refresh_token ?? "").trim();

      const developerToken = String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "").trim();
      const oauthClientId = String(process.env.GOOGLE_ADS_CLIENT_ID ?? "").trim();
      const oauthClientSecret = String(process.env.GOOGLE_ADS_CLIENT_SECRET ?? "").trim();
      const managerCustomerIdRaw = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "").trim();
      const managerCustomerId = managerCustomerIdRaw ? normalizeCustomerId(managerCustomerIdRaw) : undefined;

      if (!customerId) throw new Error("Google Ads account not selected for this client");
      if (!refreshToken) throw new Error("Google Ads not connected for this client");
      if (!developerToken || !oauthClientId || !oauthClientSecret) {
        throw new Error("Missing GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET env vars");
      }

      const cfg: GoogleCfg = {
        customerId,
        managerCustomerId,
        developerToken,
        refreshToken,
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
      };

      const byDay = await fetchGoogleDailyMetrics(cfg, startDay, endDay);

      // Ensure rows exist (if you rely on this behavior)
      await ensureDailyMetricsRows({
        clientId: clientId,
        source: "google",
        startDay,
        endDay,
      });

      const rows: DailyMetricsRow[] = days.map((day) => {
        const m = byDay.get(day) ?? { clicks: 0, impressions: 0, spend: 0, conversions: 0, conversion_value: 0 };

        const spend = Number(m.spend.toFixed(2));
        const conversions = Number(m.conversions ?? 0);
        const conversion_value = Number((m.conversion_value ?? 0).toFixed(2));

        return {
          client_id: clientId,
          source: "google",
          date: day,
          spend,

          // For ROAS / future "Ad Data" tab (primary revenue remains Shopify)
          revenue: conversion_value, // keep for backwards compatibility / ROAS
          conversion_value,

          clicks: m.clicks,
          impressions: m.impressions,
          conversions,
          orders: 0,
        };
      });

      await upsertDailyMetrics(rows);
      daysWritten += rows.length;

      results.push({ client_id: clientId, days: rows.length, status: "ok" });
    } catch (e: any) {
      errors.push({ client_id: clientId, error: e?.message || String(e) });

      if (fillZeros) {
        try {
          await ensureDailyMetricsRows({
            clientId: clientId,
            source: "google",
            startDay,
            endDay,
          });
        } catch (gapErr: any) {
          errors.push({ client_id: clientId, error: `gapFill: ${gapErr?.message || String(gapErr)}` });
        }
      }

      results.push({ client_id: clientId, days: days.length, status: "error" });
    }
  }

  return NextResponse.json({
    ok: true,
    source: "google",
    start: startDay,
    end: endDay,
    clients: integrations?.length ?? 0,
    daysWritten,
    errors,
    results,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}












